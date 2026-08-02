import Foundation

public enum RunnerProject {
    public static func materialize(in root: URL) throws -> URL {
        let manager = FileManager.default
        let project = root.appendingPathComponent(
            "MemiXCUICapture.xcodeproj",
            isDirectory: true
        )
        let scheme = project.appendingPathComponent(
            "xcshareddata/xcschemes",
            isDirectory: true
        )
        let host = root.appendingPathComponent(
            "MemiCaptureHost",
            isDirectory: true
        )
        let tests = root.appendingPathComponent(
            "MemiCaptureUITests",
            isDirectory: true
        )
        for directory in [project, scheme, host, tests] {
            try manager.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        }
        try write(projectFile, to: project.appendingPathComponent(
            "project.pbxproj"
        ))
        try write(schemeFile, to: scheme.appendingPathComponent(
            "MemiXCUICapture.xcscheme"
        ))
        try write(hostSource, to: host.appendingPathComponent(
            "AppDelegate.swift"
        ))
        try write(testSource, to: tests.appendingPathComponent(
            "MemiCaptureUITests.swift"
        ))
        return project
    }

    private static func write(_ value: String, to url: URL) throws {
        try Data(value.utf8).write(to: url, options: .atomic)
    }

    private static let hostSource = #"""
    import UIKit

    @main
    final class AppDelegate: UIResponder, UIApplicationDelegate {
        var window: UIWindow?

        func application(
            _ application: UIApplication,
            didFinishLaunchingWithOptions launchOptions:
                [UIApplication.LaunchOptionsKey: Any]? = nil
        ) -> Bool {
            let window = UIWindow(frame: UIScreen.main.bounds)
            let controller = UIViewController()
            controller.view.backgroundColor = .black
            window.rootViewController = controller
            window.makeKeyAndVisible()
            self.window = window
            return true
        }
    }
    """#

    private static let testSource = #"""
    import Foundation
    import XCTest

    private struct SourceAnchor: Codable, Equatable {
        let relativePath: String
        let symbol: String?
        let contentHash: String
    }

    private struct Scenario: Codable {
        let route: String
        let state: String
        let readinessSelector: String?
    }

    private struct RunnerInput: Codable {
        let bundleId: String
        let scenario: Scenario
        let verifiedSourceAnchor: SourceAnchor?
    }

    private struct Marker: Codable {
        let version: Int
        let route: String
        let state: String
        let readinessSelector: String?
        let readinessMatched: Bool
        let blank: Bool
        let splash: Bool
        let errorBoundary: Bool
        let sourceAnchor: SourceAnchor?
    }

    private struct Node: Codable {
        let index: Int
        let type: String
        let identifier: String
        let label: String
        let value: String?
        let enabled: Bool
        let selected: Bool
        let hittable: Bool
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    private struct RunnerResult: Codable {
        let identifiers: [String]
        let hierarchyBase64: String
        let geometryBase64: String
        let blank: Bool
    }

    final class MemiCaptureUITests: XCTestCase {
        @MainActor
        func testCaptureScenario() throws {
            let environment = ProcessInfo.processInfo.environment
            guard
                let encoded = environment["MEMI_XCUI_SCENARIO_BASE64"],
                let bytes = Data(base64Encoded: encoded)
            else {
                throw XCTSkip("Capture scenario environment is unavailable.")
            }
            let input = try JSONDecoder().decode(RunnerInput.self, from: bytes)
            let application = XCUIApplication(
                bundleIdentifier: input.bundleId
            )
            application.activate()
            let exists = application.waitForExistence(timeout: 15)
            let elements = exists
                ? application.descendants(matching: .any)
                    .allElementsBoundByAccessibilityElement
                : []
            let nodes = elements.prefix(5_000).enumerated().map {
                index, element in
                let frame = element.frame
                return Node(
                    index: index,
                    type: String(describing: element.elementType),
                    identifier: element.identifier,
                    label: element.label,
                    value: element.value.map(String.init(describing:)),
                    enabled: element.isEnabled,
                    selected: element.isSelected,
                    hittable: element.isHittable,
                    x: frame.origin.x,
                    y: frame.origin.y,
                    width: frame.size.width,
                    height: frame.size.height
                )
            }
            let identifiers = nodes.map(\.identifier).filter {
                !$0.isEmpty
            }
            let hierarchy = try JSONEncoder().encode([
                "nodes": nodes
            ])
            let geometry = try [
                "nodes": nodes.map {
                    [
                        "index": $0.index,
                        "x": $0.x,
                        "y": $0.y,
                        "width": $0.width,
                        "height": $0.height,
                    ] as [String: Any]
                }
            ].jsonObject()
            let meaningful = nodes.contains {
                $0.width > 1 && $0.height > 1 &&
                    (!$0.identifier.isEmpty || !$0.label.isEmpty)
            }
            let result = RunnerResult(
                identifiers: identifiers,
                hierarchyBase64: hierarchy.base64EncodedString(),
                geometryBase64: geometry.base64EncodedString(),
                blank: !exists || !meaningful
            )
            let output = try JSONEncoder().encode(result)
            print(
                "MEMI_XCUI_RESULT_V1:" +
                    output.base64EncodedString()
            )
            _ = "MEMI_CAPTURE_EVIDENCE_V1:"
        }
    }

    private extension Dictionary where Key == String, Value == Any {
        func jsonObject() throws -> Data {
            try JSONSerialization.data(withJSONObject: self)
        }
    }
    """#

    private static let schemeFile = #"""
    <?xml version="1.0" encoding="UTF-8"?>
    <Scheme LastUpgradeVersion="2660" version="1.7">
      <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">
        <BuildActionEntries>
          <BuildActionEntry buildForTesting="YES" buildForRunning="YES"
            buildForProfiling="NO" buildForArchiving="NO"
            buildForAnalyzing="YES">
            <BuildableReference BuildableIdentifier="primary"
              BlueprintIdentifier="A10000000000000000000001"
              BuildableName="MemiCaptureHost.app"
              BlueprintName="MemiCaptureHost"
              ReferencedContainer="container:MemiXCUICapture.xcodeproj"/>
          </BuildActionEntry>
          <BuildActionEntry buildForTesting="YES" buildForRunning="NO"
            buildForProfiling="NO" buildForArchiving="NO"
            buildForAnalyzing="NO">
            <BuildableReference BuildableIdentifier="primary"
              BlueprintIdentifier="A10000000000000000000002"
              BuildableName="MemiCaptureUITests.xctest"
              BlueprintName="MemiCaptureUITests"
              ReferencedContainer="container:MemiXCUICapture.xcodeproj"/>
          </BuildActionEntry>
        </BuildActionEntries>
      </BuildAction>
      <TestAction buildConfiguration="Debug"
        selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB"
        selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB"
        shouldUseLaunchSchemeArgsEnv="YES">
        <Testables>
          <TestableReference skipped="NO">
            <BuildableReference BuildableIdentifier="primary"
              BlueprintIdentifier="A10000000000000000000002"
              BuildableName="MemiCaptureUITests.xctest"
              BlueprintName="MemiCaptureUITests"
              ReferencedContainer="container:MemiXCUICapture.xcodeproj"/>
          </TestableReference>
        </Testables>
      </TestAction>
      <LaunchAction buildConfiguration="Debug"
        selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB"
        selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB"
        launchStyle="0" useCustomWorkingDirectory="NO"
        ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES">
        <BuildableProductRunnable runnableDebuggingMode="0">
          <BuildableReference BuildableIdentifier="primary"
            BlueprintIdentifier="A10000000000000000000001"
            BuildableName="MemiCaptureHost.app"
            BlueprintName="MemiCaptureHost"
            ReferencedContainer="container:MemiXCUICapture.xcodeproj"/>
        </BuildableProductRunnable>
      </LaunchAction>
      <ProfileAction buildConfiguration="Release"
        shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier=""
        useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/>
      <AnalyzeAction buildConfiguration="Debug"/>
      <ArchiveAction buildConfiguration="Release"
        revealArchiveInOrganizer="YES"/>
    </Scheme>
    """#

    private static let projectFile = #"""
    // !$*UTF8*$!
    {
      archiveVersion = 1;
      classes = {};
      objectVersion = 77;
      objects = {
        A00000000000000000000001 = {isa = PBXFileReference;
          lastKnownFileType = sourcecode.swift; path = AppDelegate.swift;
          sourceTree = "<group>"; };
        A00000000000000000000002 = {isa = PBXFileReference;
          lastKnownFileType = sourcecode.swift;
          path = MemiCaptureUITests.swift; sourceTree = "<group>"; };
        A00000000000000000000003 = {isa = PBXFileReference;
          explicitFileType = wrapper.application;
          path = MemiCaptureHost.app; sourceTree = BUILT_PRODUCTS_DIR; };
        A00000000000000000000004 = {isa = PBXFileReference;
          explicitFileType = wrapper.cfbundle;
          path = MemiCaptureUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };
        A00000000000000000000005 = {isa = PBXBuildFile;
          fileRef = A00000000000000000000001; };
        A00000000000000000000006 = {isa = PBXBuildFile;
          fileRef = A00000000000000000000002; };
        A00000000000000000000007 = {isa = PBXGroup; children = (
          A00000000000000000000008, A00000000000000000000009,
          A0000000000000000000000A, ); sourceTree = "<group>"; };
        A00000000000000000000008 = {isa = PBXGroup; children = (
          A00000000000000000000001, ); path = MemiCaptureHost;
          sourceTree = "<group>"; };
        A00000000000000000000009 = {isa = PBXGroup; children = (
          A00000000000000000000002, ); path = MemiCaptureUITests;
          sourceTree = "<group>"; };
        A0000000000000000000000A = {isa = PBXGroup; children = (
          A00000000000000000000003, A00000000000000000000004, );
          name = Products; sourceTree = "<group>"; };
        A0000000000000000000000B = {isa = PBXSourcesBuildPhase;
          buildActionMask = 2147483647; files = (
          A00000000000000000000005, ); runOnlyForDeploymentPostprocessing = 0; };
        A0000000000000000000000C = {isa = PBXSourcesBuildPhase;
          buildActionMask = 2147483647; files = (
          A00000000000000000000006, ); runOnlyForDeploymentPostprocessing = 0; };
        A0000000000000000000000D = {isa = PBXFrameworksBuildPhase;
          buildActionMask = 2147483647; files = ();
          runOnlyForDeploymentPostprocessing = 0; };
        A0000000000000000000000E = {isa = PBXResourcesBuildPhase;
          buildActionMask = 2147483647; files = ();
          runOnlyForDeploymentPostprocessing = 0; };
        A0000000000000000000000F = {isa = PBXContainerItemProxy;
          containerPortal = A10000000000000000000000; proxyType = 1;
          remoteGlobalIDString = A10000000000000000000001;
          remoteInfo = MemiCaptureHost; };
        A00000000000000000000010 = {isa = PBXTargetDependency;
          target = A10000000000000000000001;
          targetProxy = A0000000000000000000000F; };
        A10000000000000000000001 = {isa = PBXNativeTarget;
          buildConfigurationList = A20000000000000000000001;
          buildPhases = (A0000000000000000000000B,
          A0000000000000000000000D, A0000000000000000000000E,);
          buildRules = (); dependencies = (); name = MemiCaptureHost;
          productName = MemiCaptureHost;
          productReference = A00000000000000000000003;
          productType = "com.apple.product-type.application"; };
        A10000000000000000000002 = {isa = PBXNativeTarget;
          buildConfigurationList = A20000000000000000000002;
          buildPhases = (A0000000000000000000000C,
          A0000000000000000000000D, A0000000000000000000000E,);
          buildRules = (); dependencies = (A00000000000000000000010,);
          name = MemiCaptureUITests; productName = MemiCaptureUITests;
          productReference = A00000000000000000000004;
          productType = "com.apple.product-type.bundle.ui-testing"; };
        A10000000000000000000000 = {isa = PBXProject;
          attributes = {BuildIndependentTargetsInParallel = 1;
          LastSwiftUpdateCheck = 2660; LastUpgradeCheck = 2660;
          TargetAttributes = {
          A10000000000000000000001 = {CreatedOnToolsVersion = 26.6;};
          A10000000000000000000002 = {CreatedOnToolsVersion = 26.6;
          TestTargetID = A10000000000000000000001;};};};
          buildConfigurationList = A20000000000000000000000;
          compatibilityVersion = "Xcode 16.0"; developmentRegion = en;
          hasScannedForEncodings = 0; knownRegions = (en, Base,);
          mainGroup = A00000000000000000000007;
          productRefGroup = A0000000000000000000000A;
          projectDirPath = ""; projectRoot = "";
          targets = (A10000000000000000000001,
          A10000000000000000000002,); };
        A20000000000000000000003 = {isa = XCBuildConfiguration;
          buildSettings = {ALWAYS_SEARCH_USER_PATHS = NO;
          CLANG_ENABLE_MODULES = YES; IPHONEOS_DEPLOYMENT_TARGET = 16.0;
          SDKROOT = iphoneos; SWIFT_VERSION = 5.0;}; name = Debug; };
        A20000000000000000000004 = {isa = XCBuildConfiguration;
          buildSettings = {ALWAYS_SEARCH_USER_PATHS = NO;
          CLANG_ENABLE_MODULES = YES; IPHONEOS_DEPLOYMENT_TARGET = 16.0;
          SDKROOT = iphoneos; SWIFT_VERSION = 5.0;}; name = Release; };
        A20000000000000000000005 = {isa = XCBuildConfiguration;
          buildSettings = {CODE_SIGN_STYLE = Automatic;
          GENERATE_INFOPLIST_FILE = YES;
          PRODUCT_BUNDLE_IDENTIFIER = design.memi.canvas.capturehost;
          PRODUCT_NAME = "$(TARGET_NAME)";
          TARGETED_DEVICE_FAMILY = 1;}; name = Debug; };
        A20000000000000000000006 = {isa = XCBuildConfiguration;
          buildSettings = {CODE_SIGN_STYLE = Automatic;
          GENERATE_INFOPLIST_FILE = YES;
          PRODUCT_BUNDLE_IDENTIFIER = design.memi.canvas.capturehost;
          PRODUCT_NAME = "$(TARGET_NAME)";
          TARGETED_DEVICE_FAMILY = 1;}; name = Release; };
        A20000000000000000000007 = {isa = XCBuildConfiguration;
          buildSettings = {CODE_SIGN_STYLE = Automatic;
          GENERATE_INFOPLIST_FILE = YES;
          PRODUCT_BUNDLE_IDENTIFIER = design.memi.canvas.capturetests;
          PRODUCT_NAME = "$(TARGET_NAME)";
          TARGETED_DEVICE_FAMILY = 1;
          TEST_TARGET_NAME = MemiCaptureHost;}; name = Debug; };
        A20000000000000000000008 = {isa = XCBuildConfiguration;
          buildSettings = {CODE_SIGN_STYLE = Automatic;
          GENERATE_INFOPLIST_FILE = YES;
          PRODUCT_BUNDLE_IDENTIFIER = design.memi.canvas.capturetests;
          PRODUCT_NAME = "$(TARGET_NAME)";
          TARGETED_DEVICE_FAMILY = 1;
          TEST_TARGET_NAME = MemiCaptureHost;}; name = Release; };
        A20000000000000000000000 = {isa = XCConfigurationList;
          buildConfigurations = (A20000000000000000000003,
          A20000000000000000000004,);
          defaultConfigurationIsVisible = 0;
          defaultConfigurationName = Release; };
        A20000000000000000000001 = {isa = XCConfigurationList;
          buildConfigurations = (A20000000000000000000005,
          A20000000000000000000006,);
          defaultConfigurationIsVisible = 0;
          defaultConfigurationName = Release; };
        A20000000000000000000002 = {isa = XCConfigurationList;
          buildConfigurations = (A20000000000000000000007,
          A20000000000000000000008,);
          defaultConfigurationIsVisible = 0;
          defaultConfigurationName = Release; };
      };
      rootObject = A10000000000000000000000;
    }
    """#
}
