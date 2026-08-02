export const IOS_SIMULATOR_MACH_SERVICES = Object.freeze([
  "com.apple.CoreSimulator.CoreSimulatorService",
  "com.apple.CoreSimulator.simdiskimaged",
  "com.apple.CoreSimulator.SimDiskImageService",
  "com.apple.CoreSimulator.SimLaunchHost-arm64",
] as const);

export const IOS_BUILD_MACH_SERVICES = Object.freeze([
  "com.apple.dt.XCBBuildService",
  "com.apple.dt.SWBBuildService",
  "com.apple.launchservicesd",
  "com.apple.lsd",
  "com.apple.system.opendirectoryd.libinfo",
  "com.apple.system.opendirectoryd.membership",
  "com.apple.bsd.dirhelper",
  "com.apple.CoreServices.coreservicesd",
  "com.apple.distributed_notifications@Uv3",
  "com.apple.lsd.mapdb",
  "com.apple.lsd.modifydb",
  "com.apple.SystemConfiguration.configd",
  "com.apple.CoreDevice.CoreDeviceService",
  "com.apple.FileCoordination",
  // Xcode creates a read-only stream while it resolves its build graph. Without
  // this lookup the build service can remain idle after reporting that it could
  // not start its FSEvent stream.
  "com.apple.fsevents.matching",
  "com.apple.fseventsd",
  "com.apple.CoreSimulator.CoreSimulatorService",
  "com.apple.CoreSimulator.simdiskimaged",
  "com.apple.CoreSimulator.SimDiskImageService",
  "com.apple.DiskArbitration.diskarbitrationd",
  "com.apple.securityd.xpc",
  "com.apple.SecurityServer",
] as const);

export const IOS_GENERIC_SIMULATOR_DESTINATION =
  "generic/platform=iOS Simulator";
export const IOS_EXPO_USER_SCRIPT_SANDBOX_SETTING =
  "ENABLE_USER_SCRIPT_SANDBOXING=NO";
export const IOS_SWIFTUI_USER_SCRIPT_SANDBOX_SETTING =
  "ENABLE_USER_SCRIPT_SANDBOXING=YES";

export const IOS_CAPTURE_POLICY_AUTHORITY_V3 = Object.freeze({
  version: 3,
  simulator: Object.freeze({
    commandAuthority: "direct-simctl",
    deviceSetAuthority: "sandbox-home-default",
    xcodeReadRoot:
      "/Applications/Xcode.app/Contents/Developer",
    machLookupGlobals: IOS_SIMULATOR_MACH_SERVICES,
    deviceLiterals: Object.freeze(["/dev/null"]),
  }),
  build: Object.freeze({
    destination: IOS_GENERIC_SIMULATOR_DESTINATION,
    xcodeReadRoot: "/Applications/Xcode.app",
    machLookupGlobals: IOS_BUILD_MACH_SERVICES,
    readLiterals: Object.freeze([
      "/dev/null",
      "/private/etc/passwd",
      "/private/etc/group",
    ]),
    writeLiterals: Object.freeze(["/dev/null"]),
    metadataLiterals: Object.freeze(["/Applications"]),
    simulatorMachLookup: "platform-discovery-only",
  }),
});
