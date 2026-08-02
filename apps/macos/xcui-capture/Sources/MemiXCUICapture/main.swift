import Foundation
import MemiXCUICaptureCore

private struct RunnerInput: Codable {
    let bundleId: String
    let scenario: CaptureScenario
    let verifiedSourceAnchor: SourceAnchor?
}

private struct RunnerResult: Codable {
    let identifiers: [String]
    let hierarchyBase64: String
    let geometryBase64: String
    let blank: Bool
}

private struct EvidenceEnvelope: Codable {
    let route: String
    let state: String
    let readinessMatched: Bool
    let blank: Bool
    let splash: Bool
    let errorBoundary: Bool
    let sourceAnchor: SourceAnchor?
    let hierarchyPath: String
    let geometryPath: String
}

private func runProcess(
    executable: URL,
    arguments: [String],
    environment: [String: String]
) throws -> Data {
    let process = Process()
    let output = Pipe()
    process.executableURL = executable
    process.arguments = arguments
    process.environment = environment
    process.standardOutput = output
    process.standardError = output
    try process.run()
    let bytes = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        throw CaptureContractError.invalid(
            "The packaged XCUITest runner exited unsuccessfully."
        )
    }
    return bytes
}

private func runnerResult(from output: Data) throws -> RunnerResult {
    let prefix = "MEMI_XCUI_RESULT_V1:"
    let matches = String(decoding: output, as: UTF8.self)
        .split(whereSeparator: \.isNewline)
        .compactMap { line -> String? in
            let value = String(line)
            guard let range = value.range(of: prefix) else {
                return nil
            }
            return String(value[range.upperBound...])
        }
    guard
        matches.count == 1,
        let encoded = matches.first,
        let bytes = Data(base64Encoded: encoded)
    else {
        throw CaptureContractError.invalid(
            "The UI test runner returned no unique evidence."
        )
    }
    return try JSONDecoder().decode(RunnerResult.self, from: bytes)
}

private func marker(
    for result: RunnerResult,
    authority: ScenarioAuthority
) -> RuntimeMarker {
    let expected = RuntimeExpectation(
        route: authority.input.scenario.route,
        state: authority.input.scenario.state,
        readinessSelector: authority.input.scenario.readinessSelector,
        sourceAnchor: authority.verifiedSourceAnchor
    )
    if let exact = try? RuntimeMarker.exactlyOne(
        in: result.identifiers,
        expected: expected
    ) {
        return exact
    }
    let candidates = (try? RuntimeMarker.decoded(
        in: result.identifiers
    )) ?? []
    if candidates.count == 1, let actual = candidates.first {
        return actual
    }
    return RuntimeMarker(
        version: 1,
        route: "",
        state: "",
        readinessSelector: nil,
        readinessMatched: false,
        blank: result.blank,
        splash: false,
        errorBoundary: false,
        sourceAnchor: nil
    )
}

private func execute() throws {
    let arguments = try CaptureArguments.parse(CommandLine.arguments)
    guard
        arguments.scenarioURL.deletingLastPathComponent()
            .standardizedFileURL ==
            arguments.outputURL.deletingLastPathComponent()
                .standardizedFileURL,
        !FileManager.default.fileExists(atPath: arguments.outputURL.path)
    else {
        throw CaptureContractError.invalid(
            "Capture output authority is invalid."
        )
    }
    let managedRoot = URL(
        fileURLWithPath: FileManager.default.currentDirectoryPath,
        isDirectory: true
    )
    let authority = try ScenarioAuthority.load(
        scenarioURL: arguments.scenarioURL,
        managedRootURL: managedRoot
    )
    guard
        authority.input.deviceId == arguments.deviceID,
        authority.input.bundleId == arguments.bundleID
    else {
        throw CaptureContractError.invalid(
            "Command authority contradicts the capture scenario."
        )
    }
    let runRoot = arguments.outputURL.deletingLastPathComponent()
    let projectRoot = runRoot.appendingPathComponent(
        "runner-project",
        isDirectory: true
    )
    if FileManager.default.fileExists(atPath: projectRoot.path) {
        try FileManager.default.removeItem(at: projectRoot)
    }
    let project = try RunnerProject.materialize(in: projectRoot)
    let runnerInput = RunnerInput(
        bundleId: arguments.bundleID,
        scenario: authority.input.scenario,
        verifiedSourceAnchor: authority.verifiedSourceAnchor
    )
    let input = try JSONEncoder().encode(runnerInput)
        .base64EncodedString()
    let environment = RunnerEnvironment.xcodebuild(
        runRoot: runRoot,
        scenarioBase64: input
    )
    try FileManager.default.createDirectory(
        atPath: environment["HOME"]!,
        withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(
        atPath: environment["TMPDIR"]!,
        withIntermediateDirectories: true
    )
    let output = try runProcess(
        executable: URL(fileURLWithPath: "/usr/bin/xcodebuild"),
        arguments: [
            "-project", project.path,
            "-scheme", "MemiXCUICapture",
            "-configuration", "Debug",
            "-destination", "platform=iOS Simulator,id=\(arguments.deviceID)",
            "-derivedDataPath",
            runRoot.appendingPathComponent("runner-derived-data").path,
            "-only-testing:MemiCaptureUITests/MemiCaptureUITests/testCaptureScenario",
            "test",
        ],
        environment: environment
    )
    let result = try runnerResult(from: output)
    guard
        let hierarchy = Data(base64Encoded: result.hierarchyBase64),
        let geometry = Data(base64Encoded: result.geometryBase64),
        !hierarchy.isEmpty,
        !geometry.isEmpty
    else {
        throw CaptureContractError.invalid(
            "The UI test runner returned invalid hierarchy evidence."
        )
    }
    let hierarchyURL = runRoot.appendingPathComponent("hierarchy.json")
    let geometryURL = runRoot.appendingPathComponent("geometry.json")
    try hierarchy.write(to: hierarchyURL, options: .atomic)
    try geometry.write(to: geometryURL, options: .atomic)
    let attestation = marker(for: result, authority: authority)
    let evidence = EvidenceEnvelope(
        route: attestation.route,
        state: attestation.state,
        readinessMatched: attestation.readinessMatched,
        blank: result.blank || attestation.blank,
        splash: attestation.splash,
        errorBoundary: attestation.errorBoundary,
        sourceAnchor: attestation.sourceAnchor,
        hierarchyPath: hierarchyURL.path,
        geometryPath: geometryURL.path
    )
    try JSONEncoder().encode(evidence).write(
        to: arguments.outputURL,
        options: .atomic
    )
}

do {
    try execute()
} catch {
    FileHandle.standardError.write(
        Data("Memi XCUITest capture failed: \(error)\n".utf8)
    )
    exit(1)
}
