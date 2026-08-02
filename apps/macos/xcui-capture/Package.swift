// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MemiXCUICapture",
    platforms: [.macOS(.v13)],
    products: [
        .executable(
            name: "memi-xcui-capture",
            targets: ["MemiXCUICapture"]
        ),
        .library(
            name: "MemiXCUICaptureCore",
            targets: ["MemiXCUICaptureCore"]
        ),
    ],
    targets: [
        .target(name: "MemiXCUICaptureCore"),
        .executableTarget(
            name: "MemiXCUICapture",
            dependencies: ["MemiXCUICaptureCore"]
        ),
        .testTarget(
            name: "MemiXCUICaptureCoreTests",
            dependencies: ["MemiXCUICaptureCore"]
        ),
    ]
)
