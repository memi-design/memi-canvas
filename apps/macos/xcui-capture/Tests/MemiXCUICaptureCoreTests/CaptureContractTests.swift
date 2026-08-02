import CryptoKit
import Foundation
import Testing

@testable import MemiXCUICaptureCore

private func digest(_ value: Data) -> String {
    "sha256:" + SHA256.hash(data: value).map {
        String(format: "%02x", $0)
    }.joined()
}

private func scenarioJSON(
    relativePath: String,
    contentHash: String,
    readinessSelector: String? = "dashboard-ready"
) throws -> Data {
    let sourceAnchor: [String: Any] = [
        "relativePath": relativePath,
        "symbol": "DashboardView",
        "contentHash": contentHash,
    ]
    let scenario: [String: Any] = [
        "id": "csc_01HZZZZZZZZZZZZZZZZZZZZZZZ",
        "applicationId": "swiftui",
        "route": "view://DashboardView",
        "state": "default",
        "viewport": [
            "name": "ios-mobile",
            "width": 390,
            "height": 844,
            "scale": 3,
        ],
        "authContext": NSNull(),
        "parameters": [],
        "fixtureProfile": "default",
        "readinessSelector": readinessSelector ?? NSNull(),
        "sourceAnchor": sourceAnchor,
    ]
    return try JSONSerialization.data(withJSONObject: [
        "deviceId": "BOOTED-IPHONE",
        "bundleId": "design.memi.fixture",
        "launchId": "launch-123",
        "scenario": scenario,
    ])
}

@Suite("Memi XCUITest capture authority")
struct CaptureContractTests {
    @Test("strict command arguments reject unknown, duplicate, and relative paths")
    func strictArguments() throws {
        let parsed = try CaptureArguments.parse([
            "memi-xcui-capture",
            "--device", "BOOTED-IPHONE",
            "--bundle-id", "design.memi.fixture",
            "--scenario", "/private/tmp/scenario.json",
            "--output", "/private/tmp/evidence.json",
        ])
        #expect(parsed.deviceID == "BOOTED-IPHONE")
        #expect(parsed.bundleID == "design.memi.fixture")

        #expect(throws: CaptureContractError.self) {
            try CaptureArguments.parse([
                "memi-xcui-capture",
                "--device", "BOOTED-IPHONE",
                "--device", "OTHER",
                "--bundle-id", "design.memi.fixture",
                "--scenario", "/private/tmp/scenario.json",
                "--output", "/private/tmp/evidence.json",
            ])
        }
        #expect(throws: CaptureContractError.self) {
            try CaptureArguments.parse([
                "memi-xcui-capture",
                "--device", "BOOTED-IPHONE",
                "--bundle-id", "design.memi.fixture",
                "--scenario", "../scenario.json",
                "--output", "/private/tmp/evidence.json",
            ])
        }
    }

    @Test("source attestation hashes a contained regular Swift source")
    func sourceAttestation() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let source = root.appendingPathComponent(
            "Sources/DashboardView.swift"
        )
        try FileManager.default.createDirectory(
            at: source.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let bytes = Data("struct DashboardView: View {}".utf8)
        try bytes.write(to: source)
        let scenario = root.appendingPathComponent("scenario.json")
        try scenarioJSON(
            relativePath: "Sources/DashboardView.swift",
            contentHash: digest(bytes)
        ).write(to: scenario)

        let authority = try ScenarioAuthority.load(
            scenarioURL: scenario,
            managedRootURL: root
        )
        #expect(authority.input.scenario.sourceAnchor?.symbol == "DashboardView")
        #expect(authority.verifiedSourceAnchor?.contentHash == digest(bytes))

        let outside = root.deletingLastPathComponent().appendingPathComponent(
            "\(UUID().uuidString).swift"
        )
        try bytes.write(to: outside)
        let linked = root.appendingPathComponent("Linked.swift")
        try FileManager.default.createSymbolicLink(
            at: linked,
            withDestinationURL: outside
        )
        try scenarioJSON(
            relativePath: "Linked.swift",
            contentHash: digest(bytes)
        ).write(to: scenario)
        #expect(throws: CaptureContractError.self) {
            try ScenarioAuthority.load(
                scenarioURL: scenario,
                managedRootURL: root
            )
        }
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.removeItem(at: outside)
    }

    @Test("source and runtime evidence must both match the scenario")
    func evidenceAttestation() throws {
        let source = SourceAnchor(
            relativePath: "Sources/DashboardView.swift",
            symbol: "DashboardView",
            contentHash: "sha256:" + String(repeating: "a", count: 64)
        )
        let expected = RuntimeExpectation(
            route: "view://DashboardView",
            state: "default",
            readinessSelector: "dashboard-ready",
            sourceAnchor: source
        )
        let marker = RuntimeMarker(
            version: 1,
            route: expected.route,
            state: expected.state,
            readinessSelector: expected.readinessSelector,
            readinessMatched: true,
            blank: false,
            splash: false,
            errorBoundary: false,
            sourceAnchor: source
        )
        let encoded = try marker.encodedAccessibilityIdentifier()

        #expect(
            try RuntimeMarker.exactlyOne(
                in: ["other", encoded],
                expected: expected
            ) == marker
        )
        #expect(throws: CaptureContractError.self) {
            try RuntimeMarker.exactlyOne(
                in: [encoded, encoded],
                expected: expected
            )
        }
        #expect(throws: CaptureContractError.self) {
            try RuntimeMarker.exactlyOne(
                in: [
                    try RuntimeMarker(
                        version: 1,
                        route: "view://OtherView",
                        state: marker.state,
                        readinessSelector: marker.readinessSelector,
                        readinessMatched: true,
                        blank: false,
                        splash: false,
                        errorBoundary: false,
                        sourceAnchor: source
                    ).encodedAccessibilityIdentifier(),
                ],
                expected: expected
            )
        }
    }

    @Test("the generated runner is a UI test target that attaches by bundle identifier")
    func runnerProject() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let project = try RunnerProject.materialize(in: root)
        let pbx = try String(
            contentsOf: project.appendingPathComponent(
                "project.pbxproj"
            ),
            encoding: .utf8
        )
        let testSource = try String(
            contentsOf: root.appendingPathComponent(
                "MemiCaptureUITests/MemiCaptureUITests.swift"
            ),
            encoding: .utf8
        )
        #expect(pbx.contains("com.apple.product-type.bundle.ui-testing"))
        #expect(testSource.contains("bundleIdentifier: input.bundleId"))
        #expect(testSource.contains(RuntimeMarker.accessibilityPrefix))
        #expect(!testSource.contains("sourceAnchor: scenario.sourceAnchor"))
        try? FileManager.default.removeItem(at: root)
    }

    @Test("Xcode passes the scenario only to its isolated test runner")
    func testRunnerEnvironment() {
        let root = URL(
            fileURLWithPath: "/private/tmp/memi-xcui-run",
            isDirectory: true
        )
        let environment = RunnerEnvironment.xcodebuild(
            runRoot: root,
            scenarioBase64: "c2NlbmFyaW8="
        )

        #expect(
            environment["TEST_RUNNER_MEMI_XCUI_SCENARIO_BASE64"] ==
                "c2NlbmFyaW8="
        )
        #expect(environment["MEMI_XCUI_SCENARIO_BASE64"] == nil)
        #expect(environment["HOME"] == "/private/tmp/memi-xcui-run/home")
        #expect(environment["TMPDIR"] == "/private/tmp/memi-xcui-run/tmp")
    }

    @Test("the generated UI test project builds for an iOS simulator")
    func runnerProjectBuilds() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let project = try RunnerProject.materialize(in: root)
        let log = root.appendingPathComponent("xcodebuild.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let handle = try FileHandle(forWritingTo: log)
        defer {
            try? handle.close()
            try? FileManager.default.removeItem(at: root)
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcodebuild")
        process.arguments = [
            "-project", project.path,
            "-scheme", "MemiXCUICapture",
            "-sdk", "iphonesimulator",
            "-destination", "generic/platform=iOS Simulator",
            "-derivedDataPath", root.appendingPathComponent("DerivedData").path,
            "CODE_SIGNING_ALLOWED=NO",
            "build-for-testing",
        ]
        process.standardOutput = handle
        process.standardError = handle
        try process.run()
        process.waitUntilExit()
        let output = try String(contentsOf: log, encoding: .utf8)
        #expect(
            process.terminationStatus == 0,
            "Generated XCUITest runner did not build:\n\(output)"
        )
    }
}
