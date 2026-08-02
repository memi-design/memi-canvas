import Foundation

public enum RunnerEnvironment {
    public static func xcodebuild(
        runRoot: URL,
        scenarioBase64: String
    ) -> [String: String] {
        [
            "HOME": runRoot.appendingPathComponent("home").path,
            "TMPDIR": runRoot.appendingPathComponent("tmp").path,
            "PATH": "/usr/bin:/bin",
            // xcodebuild strips TEST_RUNNER_ before forwarding this value to
            // the isolated UI-test runner process.
            "TEST_RUNNER_MEMI_XCUI_SCENARIO_BASE64": scenarioBase64,
        ]
    }
}
