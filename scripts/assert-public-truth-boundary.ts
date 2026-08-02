import { inspectPublicTruth } from "./public-truth-boundary.js";

const findings = await inspectPublicTruth(process.cwd());

if (findings.length > 0) {
  throw new Error(
    `Public truth boundary failed:\n${findings
      .map(
        ({ code, detail, line, path }) =>
          `- [${code}] ${path}${line === undefined ? "" : `:${line}`}: ${detail}`,
      )
      .join("\n")}`,
  );
}

console.log(
  JSON.stringify({
    brandAssetHashesVerified: true,
    legacyBrandNameExcluded: true,
    productionClaimsQualified: true,
    publicStatus: "In development",
  }),
);
