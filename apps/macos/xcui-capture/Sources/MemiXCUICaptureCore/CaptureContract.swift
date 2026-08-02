import CryptoKit
import Foundation

public enum CaptureContractError: Error, CustomStringConvertible {
    case invalid(String)

    public var description: String {
        switch self {
        case .invalid(let message): message
        }
    }
}

public struct CaptureArguments: Equatable, Sendable {
    public let deviceID: String
    public let bundleID: String
    public let scenarioURL: URL
    public let outputURL: URL

    public static func parse(_ arguments: [String]) throws -> Self {
        var values: [String: String] = [:]
        var index = 1
        while index < arguments.count {
            let key = arguments[index]
            guard
                ["--device", "--bundle-id", "--scenario", "--output"]
                    .contains(key),
                values[key] == nil,
                index + 1 < arguments.count
            else {
                throw CaptureContractError.invalid(
                    "Capture arguments are invalid."
                )
            }
            values[key] = arguments[index + 1]
            index += 2
        }
        guard
            values.count == 4,
            let device = values["--device"],
            let bundle = values["--bundle-id"],
            let scenario = values["--scenario"],
            let output = values["--output"],
            device.range(
                of: #"^[A-Za-z0-9._:-]{1,160}$"#,
                options: .regularExpression
            ) != nil,
            bundle.range(
                of: #"^[A-Za-z0-9.-]{3,255}$"#,
                options: .regularExpression
            ) != nil,
            scenario.hasPrefix("/"),
            output.hasPrefix("/")
        else {
            throw CaptureContractError.invalid(
                "Capture arguments are outside their safe bounds."
            )
        }
        return Self(
            deviceID: device,
            bundleID: bundle,
            scenarioURL: URL(fileURLWithPath: scenario),
            outputURL: URL(fileURLWithPath: output)
        )
    }
}

public struct SourceAnchor: Codable, Equatable, Sendable {
    public let relativePath: String
    public let symbol: String?
    public let contentHash: String

    public init(
        relativePath: String,
        symbol: String?,
        contentHash: String
    ) {
        self.relativePath = relativePath
        self.symbol = symbol
        self.contentHash = contentHash
    }
}

public struct CaptureScenario: Codable, Equatable, Sendable {
    public struct Viewport: Codable, Equatable, Sendable {
        public let name: String
        public let width: Int
        public let height: Int
        public let scale: Double
    }

    public struct Parameter: Codable, Equatable, Sendable {
        public let key: String
        public let value: String
    }

    public let id: String
    public let applicationId: String
    public let route: String
    public let state: String
    public let viewport: Viewport
    public let authContext: String?
    public let parameters: [Parameter]
    public let fixtureProfile: String
    public let readinessSelector: String?
    public let sourceAnchor: SourceAnchor?
}

public struct CaptureInput: Codable, Equatable, Sendable {
    public let deviceId: String
    public let bundleId: String
    public let launchId: String
    public let scenario: CaptureScenario
}

public struct ScenarioAuthority: Equatable, Sendable {
    public let input: CaptureInput
    public let verifiedSourceAnchor: SourceAnchor?

    public static func load(
        scenarioURL: URL,
        managedRootURL: URL
    ) throws -> Self {
        let scenarioValues = try scenarioURL.resourceValues(
            forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
        )
        guard
            scenarioValues.isRegularFile == true,
            scenarioValues.isSymbolicLink != true,
            (scenarioValues.fileSize ?? Int.max) <= 1_048_576
        else {
            throw CaptureContractError.invalid(
                "Scenario authority must be a bounded regular file."
            )
        }
        let input = try JSONDecoder().decode(
            CaptureInput.self,
            from: Data(contentsOf: scenarioURL)
        )
        guard
            input.deviceId.range(
                of: #"^[A-Za-z0-9._:-]{1,160}$"#,
                options: .regularExpression
            ) != nil,
            input.bundleId.range(
                of: #"^[A-Za-z0-9.-]{3,255}$"#,
                options: .regularExpression
            ) != nil
        else {
            throw CaptureContractError.invalid(
                "Scenario identifiers are invalid."
            )
        }
        let root = managedRootURL.resolvingSymlinksInPath()
            .standardizedFileURL
        guard root.path != "/" else {
            throw CaptureContractError.invalid(
                "Managed source root is unbounded."
            )
        }
        let verified = try input.scenario.sourceAnchor.map { anchor in
            guard
                !anchor.relativePath.isEmpty,
                !anchor.relativePath.hasPrefix("/"),
                !anchor.relativePath.split(separator: "/")
                    .contains(where: { $0 == ".." || $0 == "." }),
                anchor.contentHash.range(
                    of: #"^sha256:[a-f0-9]{64}$"#,
                    options: .regularExpression
                ) != nil
            else {
                throw CaptureContractError.invalid(
                    "Source anchor is invalid."
                )
            }
            let source = root.appendingPathComponent(anchor.relativePath)
            let values = try source.resourceValues(
                forKeys: [
                    .isRegularFileKey,
                    .isSymbolicLinkKey,
                    .fileSizeKey,
                ]
            )
            let canonical = source.resolvingSymlinksInPath()
                .standardizedFileURL
            guard
                values.isRegularFile == true,
                values.isSymbolicLink != true,
                canonical.path.hasPrefix(root.path + "/"),
                (values.fileSize ?? Int.max) <= 16 * 1_024 * 1_024
            else {
                throw CaptureContractError.invalid(
                    "Source anchor escapes the managed worktree."
                )
            }
            let hash = "sha256:" + SHA256.hash(
                data: try Data(contentsOf: canonical)
            ).map { String(format: "%02x", $0) }.joined()
            guard hash == anchor.contentHash else {
                throw CaptureContractError.invalid(
                    "Source anchor hash does not match the managed source."
                )
            }
            return anchor
        }
        return Self(input: input, verifiedSourceAnchor: verified)
    }
}

public struct RuntimeExpectation: Equatable, Sendable {
    public let route: String
    public let state: String
    public let readinessSelector: String?
    public let sourceAnchor: SourceAnchor?

    public init(
        route: String,
        state: String,
        readinessSelector: String?,
        sourceAnchor: SourceAnchor?
    ) {
        self.route = route
        self.state = state
        self.readinessSelector = readinessSelector
        self.sourceAnchor = sourceAnchor
    }
}

public struct RuntimeMarker: Codable, Equatable, Sendable {
    public static let accessibilityPrefix =
        "MEMI_CAPTURE_EVIDENCE_V1:"

    public let version: Int
    public let route: String
    public let state: String
    public let readinessSelector: String?
    public let readinessMatched: Bool
    public let blank: Bool
    public let splash: Bool
    public let errorBoundary: Bool
    public let sourceAnchor: SourceAnchor?

    public init(
        version: Int,
        route: String,
        state: String,
        readinessSelector: String?,
        readinessMatched: Bool,
        blank: Bool,
        splash: Bool,
        errorBoundary: Bool,
        sourceAnchor: SourceAnchor?
    ) {
        self.version = version
        self.route = route
        self.state = state
        self.readinessSelector = readinessSelector
        self.readinessMatched = readinessMatched
        self.blank = blank
        self.splash = splash
        self.errorBoundary = errorBoundary
        self.sourceAnchor = sourceAnchor
    }

    public func encodedAccessibilityIdentifier() throws -> String {
        Self.accessibilityPrefix +
            (try String(
                data: JSONEncoder().encode(self),
                encoding: .utf8
            ).unwrap("Runtime marker is not UTF-8."))
    }

    public static func exactlyOne(
        in identifiers: [String],
        expected: RuntimeExpectation
    ) throws -> Self {
        let candidates = try decoded(in: identifiers)
        guard candidates.count == 1, let marker = candidates.first else {
            throw CaptureContractError.invalid(
                "Runtime must expose exactly one capture attestation."
            )
        }
        guard
            marker.version == 1,
            marker.route == expected.route,
            marker.state == expected.state,
            marker.readinessSelector == expected.readinessSelector,
            marker.readinessMatched,
            !marker.blank,
            !marker.splash,
            !marker.errorBoundary,
            marker.sourceAnchor == expected.sourceAnchor
        else {
            throw CaptureContractError.invalid(
                "Runtime capture attestation contradicts the scenario."
            )
        }
        return marker
    }

    public static func decoded(in identifiers: [String]) throws -> [Self] {
        try identifiers.compactMap { identifier -> Self? in
            guard identifier.hasPrefix(accessibilityPrefix) else {
                return nil
            }
            return try JSONDecoder().decode(
                Self.self,
                from: Data(
                    identifier.dropFirst(accessibilityPrefix.count).utf8
                )
            )
        }
    }
}

private extension Optional where Wrapped == String {
    func unwrap(_ message: String) throws -> String {
        guard let self else {
            throw CaptureContractError.invalid(message)
        }
        return self
    }
}
