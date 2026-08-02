import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REACT_NATIVE_GLOG_SCRIPT = join(
  "node_modules",
  "react-native",
  "scripts",
  "ios-configure-glog.sh",
);
const REACT_NATIVE_GLOG_CONFIGURE = "./configure --host arm-apple-darwin || true";
const MEMI_GLOG_COMPATIBILITY_MARKER =
  "# Memi capture: deterministic glog 0.3.5 headers for iOS Simulator.";

const CONFIG_TRUE_MACROS = [
  "HAVE_DLADDR",
  "HAVE_DLFCN_H",
  "HAVE_EXECINFO_H",
  "HAVE_FCNTL",
  "HAVE_GLOB_H",
  "HAVE_INTTYPES_H",
  "HAVE_LIBPTHREAD",
  "HAVE_LIBUNWIND_H",
  "HAVE_MEMORY_H",
  "HAVE_NAMESPACES",
  "HAVE_PREAD",
  "HAVE_PTHREAD",
  "HAVE_PWD_H",
  "HAVE_PWRITE",
  "HAVE_RWLOCK",
  "HAVE_SIGACTION",
  "HAVE_SIGALTSTACK",
  "HAVE_STDINT_H",
  "HAVE_STDLIB_H",
  "HAVE_STRINGS_H",
  "HAVE_STRING_H",
  "HAVE_SYSLOG_H",
  "HAVE_SYS_STAT_H",
  "HAVE_SYS_SYSCALL_H",
  "HAVE_SYS_TIME_H",
  "HAVE_SYS_TYPES_H",
  "HAVE_SYS_UCONTEXT_H",
  "HAVE_SYS_UTSNAME_H",
  "HAVE_UNISTD_H",
  "HAVE_UNWIND_H",
  "HAVE_USING_OPERATOR",
  "HAVE___ATTRIBUTE__",
  "HAVE___BUILTIN_EXPECT",
  "HAVE___SYNC_VAL_COMPARE_AND_SWAP",
] as const;

const CONFIG_VALUE_MACROS = [
  ["GOOGLE_NAMESPACE", "google"],
  ["LT_OBJDIR", '".libs/"'],
  ["PACKAGE", '"glog"'],
  ["PACKAGE_BUGREPORT", '"opensource@google.com"'],
  ["PACKAGE_NAME", '"glog"'],
  ["PACKAGE_STRING", '"glog 0.3.5"'],
  ["PACKAGE_TARNAME", '"glog"'],
  ["PACKAGE_URL", '""'],
  ["PACKAGE_VERSION", '"0.3.5"'],
  ["SIZEOF_VOID_P", "8"],
  ["STL_NAMESPACE", "std"],
  ["TEST_SRC_DIR", '"."'],
  ["VERSION", '"0.3.5"'],
  ["_END_GOOGLE_NAMESPACE_", "}"],
  ["_START_GOOGLE_NAMESPACE_", "namespace google {"],
] as const;

const HEADER_REPLACEMENTS = [
  ["@ac_cv_have_unistd_h@", "1"],
  ["@ac_cv_have_stdint_h@", "1"],
  ["@ac_cv_have_systypes_h@", "1"],
  ["@ac_cv_have_inttypes_h@", "1"],
  ["@ac_cv_have_uint16_t@", "1"],
  ["@ac_cv_have_u_int16_t@", "1"],
  ["@ac_cv_have___uint16@", "0"],
  ["@ac_cv_have___builtin_expect@", "1"],
  ["@ac_cv_cxx_using_operator@", "1"],
  ["@ac_cv___attribute___noinline@", "__attribute__ ((noinline))"],
  ["@ac_cv___attribute___noreturn@", "__attribute__ ((noreturn))"],
  [
    "@ac_cv___attribute___printf_4_5@",
    "__attribute__((__format__ (__printf__, 4, 5)))",
  ],
  ["@ac_google_start_namespace@", "namespace google {"],
  ["@ac_google_end_namespace@", "}"],
  ["@ac_google_namespace@", "google"],
] as const;

function sedExpression(search: string, replacement: string): string {
  return "  -e 's|" + search + "|" + replacement + "|g'";
}

function defineExpression(macro: string, value: string): string {
  return "  -e 's|^#undef " + macro + "$|#define " + macro + " " + value + "|'";
}

function deterministicRenderer(): string {
  const headerExpressions = HEADER_REPLACEMENTS
    .map(([search, replacement]) => sedExpression(search, replacement))
    .join(" \\\n");
  const configExpressions = [
    ...CONFIG_TRUE_MACROS.map((macro) => defineExpression(macro, "1")),
    ...CONFIG_VALUE_MACROS.map(([macro, value]) =>
      defineExpression(macro, value)),
  ].join(" \\\n");
  return [
    MEMI_GLOG_COMPATIBILITY_MARKER,
    "# The legacy Autoconf probe can stall under the managed capture sandbox.",
    "# Render the reviewed glog 0.3.5 iOS Simulator substitutions instead.",
    "for header in logging raw_logging stl_logging vlog_is_on; do",
    "  sed \\",
    headerExpressions + " \\",
    '    "src/glog/$header.h.in" > "src/glog/$header.h"',
    "done",
    "sed \\",
    configExpressions + " \\",
    "  src/config.h.in > src/config.h",
  ].join("\n");
}

export class GlogCompatibilityError extends Error {
  constructor(
    readonly code:
      | "NATIVE_DEPENDENCY_GLOG_COMPATIBILITY_FAILED"
      | "NATIVE_DEPENDENCY_GLOG_COMPATIBILITY_UNAVAILABLE",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Replaces only the reviewed, generated React Native glog hook in a managed
 * worktree. It never reads or writes the imported repository checkout.
 */
export async function stabilizeManagedReactNativeGlog(
  platformRoot: string,
): Promise<void> {
  const scriptPath = join(platformRoot, REACT_NATIVE_GLOG_SCRIPT);
  let script: string;
  try {
    script = await readFile(scriptPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw new GlogCompatibilityError(
      "NATIVE_DEPENDENCY_GLOG_COMPATIBILITY_FAILED",
      true,
      error instanceof Error
        ? error.message
        : "Cannot read React Native glog hook.",
    );
  }
  if (script.includes(MEMI_GLOG_COMPATIBILITY_MARKER)) return;
  if (script.split(REACT_NATIVE_GLOG_CONFIGURE).length - 1 !== 1) {
    throw new GlogCompatibilityError(
      "NATIVE_DEPENDENCY_GLOG_COMPATIBILITY_UNAVAILABLE",
      false,
      "The installed React Native glog hook no longer matches Memi's reviewed iOS Simulator renderer.",
    );
  }
  await writeFile(
    scriptPath,
    script.replace(REACT_NATIVE_GLOG_CONFIGURE, deterministicRenderer()),
    "utf8",
  );
}
