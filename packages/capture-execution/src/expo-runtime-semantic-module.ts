export function expoRuntimeSemanticModule(
  sourceRevision: string,
  readinessToken: string,
): string {
  return `import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useGlobalSearchParams, usePathname } from "expo-router";
import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Animated,
  findNodeHandle,
  Image,
  Linking,
  StyleSheet,
  UIManager,
} from "react-native";

const SOURCE_REVISION = ${JSON.stringify(sourceRevision)};
const RUNTIME_TOKEN = ${JSON.stringify(readinessToken)};
const READINESS_MARKER = ${JSON.stringify(`MEMI_CAPTURE_READY_V1:${readinessToken}`)};
const NONCE = /^[0-9A-HJKMNP-TV-Z]{26}$/u;
const EVIDENCE_PREFIX = "MEMI_CAPTURE_EVIDENCE_V1:";
const memiAnimatedLoop = Animated.loop.bind(Animated);
Animated.loop = (animation, configuration = {}) =>
  memiAnimatedLoop(animation, { ...configuration, iterations: 0 });
const ParentLayerContext = createContext(null);
let registry = new Map();
let listeners = new Set();
let sequence = 0;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value, maximum = 4096) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximum)
    : undefined;
}

function notify() {
  for (const listener of listeners) listener();
}

function upsert(layerId, patch) {
  const current = registry.get(layerId) ?? {};
  registry = new Map(registry);
  registry.set(layerId, { ...current, ...patch });
  notify();
}

function remove(layerId) {
  if (!registry.has(layerId)) return;
  registry = new Map(registry);
  registry.delete(layerId);
  notify();
}

function subscribe(listener) {
  listeners = new Set(listeners).add(listener);
  return () => {
    const next = new Set(listeners);
    next.delete(listener);
    listeners = next;
  };
}

function captureSession(nonce, state, expectedRoute) {
  if (
    typeof nonce !== "string" ||
    !NONCE.test(nonce) ||
    typeof state !== "string" ||
    state.length === 0 ||
    state.length > 160 ||
    typeof expectedRoute !== "string" ||
    !expectedRoute.startsWith("/") ||
    expectedRoute.includes("\\\\") ||
    expectedRoute.includes("\\0")
  ) {
    return null;
  }
  return { nonce, state, expectedRoute };
}

function captureSessionFromUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    const session = captureSession(
      url.searchParams.get("__memi_capture"),
      url.searchParams.get("__memi_state"),
      url.pathname,
    );
    return session === null ? null : { ...session, expectedRoute: url.pathname };
  } catch {
    return null;
  }
}

function storedCaptureSession(value) {
  if (!value.startsWith(EVIDENCE_PREFIX)) return null;
  try {
    const candidate = JSON.parse(value.slice(EVIDENCE_PREFIX.length));
    if (
      candidate?.version !== 1 ||
      candidate?.sourceRevision !== SOURCE_REVISION
    ) {
      return null;
    }
    return captureSession(candidate.nonce, candidate.state, candidate.route);
  } catch {
    return null;
  }
}

function simpleStyle(style) {
  const resolved = StyleSheet.flatten(style) ?? {};
  const stringValue = (key) => text(resolved[key], 160);
  const numberValue = (key) => finite(resolved[key]);
  const fontWeight =
    typeof resolved.fontWeight === "number"
      ? resolved.fontWeight
      : typeof resolved.fontWeight === "string"
        ? Number.parseInt(resolved.fontWeight, 10)
        : undefined;
  const shadow =
    text(resolved.shadowColor, 120) === undefined
      ? undefined
      : JSON.stringify({
          color: text(resolved.shadowColor, 120),
          offset: resolved.shadowOffset,
          opacity: numberValue("shadowOpacity"),
          radius: numberValue("shadowRadius"),
        }).slice(0, 512);
  return {
    ...(stringValue("backgroundColor") === undefined
      ? {}
      : { fill: stringValue("backgroundColor") }),
    ...(stringValue("borderColor") === undefined
      ? {}
      : { stroke: stringValue("borderColor") }),
    ...(stringValue("color") === undefined
      ? {}
      : { textColor: stringValue("color") }),
    ...(stringValue("fontFamily") === undefined
      ? {}
      : { fontFamily: stringValue("fontFamily") }),
    ...(numberValue("fontSize") === undefined
      ? {}
      : { fontSize: numberValue("fontSize") }),
    ...(Number.isFinite(fontWeight) && fontWeight >= 1 && fontWeight <= 1000
      ? { fontWeight }
      : {}),
    ...(numberValue("letterSpacing") === undefined
      ? {}
      : { letterSpacing: numberValue("letterSpacing") }),
    ...(numberValue("lineHeight") === undefined
      ? {}
      : { lineHeight: numberValue("lineHeight") }),
    ...(numberValue("opacity") === undefined
      ? {}
      : { opacity: Math.max(0, Math.min(1, numberValue("opacity"))) }),
    ...(shadow === undefined ? {} : { shadow }),
  };
}

function simpleLayout(style) {
  const resolved = StyleSheet.flatten(style) ?? {};
  const direction =
    resolved.flexDirection === "row" || resolved.flexDirection === "row-reverse"
      ? "row"
      : resolved.flexDirection === "column" ||
          resolved.flexDirection === "column-reverse"
        ? "column"
        : undefined;
  const gap = finite(resolved.gap);
  const padding = {
    top: finite(resolved.paddingTop ?? resolved.paddingVertical ?? resolved.padding) ?? 0,
    right: finite(resolved.paddingRight ?? resolved.paddingHorizontal ?? resolved.padding) ?? 0,
    bottom: finite(resolved.paddingBottom ?? resolved.paddingVertical ?? resolved.padding) ?? 0,
    left: finite(resolved.paddingLeft ?? resolved.paddingHorizontal ?? resolved.padding) ?? 0,
  };
  const align = ["flex-start", "center", "flex-end", "stretch"].includes(
    resolved.alignItems,
  )
    ? resolved.alignItems.replace("flex-", "")
    : undefined;
  const justify = ["flex-start", "center", "flex-end", "space-between"].includes(
    resolved.justifyContent,
  )
    ? resolved.justifyContent.replace("flex-", "")
    : undefined;
  if (
    direction === undefined &&
    gap === undefined &&
    Object.values(padding).every((value) => value === 0) &&
    align === undefined &&
    justify === undefined
  ) {
    return undefined;
  }
  return {
    position: "absolute",
    ...(direction === undefined
      ? {}
      : {
          flex: {
            direction,
            ...(resolved.flexWrap === "wrap" ? { wrap: true } : {}),
          },
        }),
    ...(gap === undefined ? {} : { gap: Math.max(0, gap) }),
    padding,
    ...(align === undefined ? {} : { align }),
    ...(justify === undefined ? {} : { justify }),
  };
}

function childText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(childText).join("");
  if (React.isValidElement(value)) return childText(value.props?.children);
  return "";
}

function imageValue(source) {
  try {
    return text(Image.resolveAssetSource(source)?.uri, 4096);
  } catch {
    return undefined;
  }
}

function assignRef(ref, value) {
  if (typeof ref === "function") ref(value);
  else if (ref !== null && typeof ref === "object") ref.current = value;
}

function measure(entry) {
  return new Promise((resolve) => {
    const handle = findNodeHandle(entry.ref.current);
    if (handle === null) {
      resolve(null);
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, 150);
    UIManager.measureInWindow(handle, (x, y, width, height) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(
        [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
          ? { x, y, width, height }
          : null,
      );
    });
  });
}

async function measuredLayers() {
  const entries = [...registry.values()];
  const measured = await Promise.all(
    entries.map(async (entry) => ({ entry, absolute: await measure(entry) })),
  );
  const valid = measured.filter(({ absolute }) => absolute !== null);
  const absoluteById = new Map(
    valid.map(({ entry, absolute }) => [entry.layerId, absolute]),
  );
  return valid
    .sort((left, right) => left.entry.sequence - right.entry.sequence)
    .slice(0, 1000)
    .map(({ entry, absolute }, zIndex) => {
      const parent = absoluteById.get(entry.parentLayerId);
      const parentLayerId = parent === undefined ? undefined : entry.parentLayerId;
      const radius = finite(StyleSheet.flatten(entry.style)?.borderRadius);
      return {
        layerId: entry.layerId,
        semanticKey: entry.semanticKey,
        name: entry.name,
        kind: entry.kind,
        ...(parentLayerId === undefined ? {} : { parentLayerId }),
        geometry: {
          x: absolute.x - (parent?.x ?? 0),
          y: absolute.y - (parent?.y ?? 0),
          width: absolute.width,
          height: absolute.height,
          rotation: 0,
          ...(radius === undefined ? {} : { cornerRadius: Math.max(0, radius) }),
          ...(entry.clip === true ? { clip: true } : {}),
        },
        style: simpleStyle(entry.style),
        ...(simpleLayout(entry.style) === undefined
          ? {}
          : { layout: simpleLayout(entry.style) }),
        content: entry.content,
        source: entry.source,
        zIndex,
      };
    });
}

export const MemiCapturePrimitive = forwardRef(function MemiCapturePrimitive(
  props,
  forwardedRef,
) {
  const {
    component: Component,
    captureMetadata,
    children,
    onLayout,
    style,
    ...componentProps
  } = props;
  const parentLayerId = useContext(ParentLayerContext);
  const instanceId = useId().replace(/[^A-Za-z0-9_-]/gu, "");
  const layerId = captureMetadata.layerId + "-" + instanceId;
  const nativeRef = useRef(null);
  const setNativeRef = useCallback(
    (value) => {
      nativeRef.current = value;
      assignRef(forwardedRef, value);
    },
    [forwardedRef],
  );
  const content = {
    ...(captureMetadata.kind === "text" && childText(children).length > 0
      ? { text: childText(children).slice(0, 1000000) }
      : {}),
    ...(captureMetadata.kind === "image" && imageValue(componentProps.source) !== undefined
      ? { value: imageValue(componentProps.source) }
      : {}),
    ...(text(componentProps.placeholder, 4096) === undefined
      ? {}
      : { placeholder: text(componentProps.placeholder, 4096) }),
    ...(text(componentProps.value, 4096) === undefined
      ? {}
      : { value: text(componentProps.value, 4096) }),
    ...(typeof componentProps.accessibilityState?.selected === "boolean"
      ? { selected: componentProps.accessibilityState.selected }
      : {}),
  };
  useEffect(() => {
    const nextSequence = sequence++;
    upsert(layerId, {
      ...captureMetadata,
      layerId,
      semanticKey: captureMetadata.semanticKey + "-" + instanceId,
      name:
        text(componentProps.accessibilityLabel, 512) ??
        text(componentProps.testID, 512) ??
        captureMetadata.name,
      parentLayerId,
      content,
      ref: nativeRef,
      sequence: nextSequence,
      style,
    });
    return () => remove(layerId);
  }, [captureMetadata, componentProps.accessibilityLabel, componentProps.testID,
      content.placeholder, content.selected, content.text, content.value,
      layerId, parentLayerId, style]);
  const handleLayout = useCallback(
    (event) => {
      upsert(layerId, { layoutEvent: event.nativeEvent.layout });
      if (typeof onLayout === "function") onLayout(event);
    },
    [layerId, onLayout],
  );
  const hostProps = {
    ...componentProps,
    ref: setNativeRef,
    style,
    onLayout: handleLayout,
    ...(captureMetadata.kind === "frame" ||
    captureMetadata.kind === "group" ||
    captureMetadata.kind === "component-instance"
      ? { collapsable: false }
      : {}),
  };
  return React.createElement(
    ParentLayerContext.Provider,
    { value: layerId },
    React.createElement(Component, hostProps, children),
  );
});

export function MemiCaptureRuntimeAttestation() {
  const pathname = usePathname();
  const parameters = useGlobalSearchParams();
  const nonce = parameters.__memi_capture;
  const state = parameters.__memi_state;
  const [session, setSession] = useState(() =>
    captureSession(nonce, state, pathname),
  );
  const [registryRevision, setRegistryRevision] = useState(0);
  useEffect(() => {
    void Clipboard.setStringAsync(READINESS_MARKER).catch(() => undefined);
  }, []);
  useEffect(() => subscribe(() => setRegistryRevision((value) => value + 1)), []);
  useEffect(() => {
    let cancelled = false;
    const acceptUrl = (value) => {
      const fromUrl = captureSessionFromUrl(value);
      if (!cancelled && fromUrl !== null) setSession(fromUrl);
    };
    void Linking.getInitialURL()
      .then(acceptUrl)
      .catch(() => undefined);
    const subscription = Linking.addEventListener("url", (event) => {
      const fromUrl = captureSessionFromUrl(event.url);
      if (!cancelled && fromUrl !== null) setSession(fromUrl);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    const fromParameters = captureSession(nonce, state, pathname);
    if (fromParameters !== null) {
      setSession(fromParameters);
      return;
    }
    void Clipboard.getStringAsync()
      .then((value) => {
        const restored = storedCaptureSession(value);
        if (restored !== null) setSession((current) => current ?? restored);
      })
      .catch(() => undefined);
  }, [nonce, pathname, state]);
  useEffect(() => {
    if (session === null || pathname !== session.expectedRoute) return undefined;
    let cancelled = false;
    const timeout = setTimeout(() => {
      void measuredLayers().then((layers) => {
        if (cancelled || layers.length === 0) return;
        const payload = {
          version: 1,
          nonce: session.nonce,
          sourceRevision: SOURCE_REVISION,
          runtimeToken: RUNTIME_TOKEN,
          route: pathname,
          state: session.state,
          readinessSelector: null,
          readinessMatched: true,
          blank: false,
          splash: false,
          errorBoundary: false,
          semanticCapture: {
            appVersion: Constants.expoConfig?.version ?? "managed-capture",
            layers,
          },
        };
        return Clipboard.setStringAsync(
          EVIDENCE_PREFIX + JSON.stringify(payload),
        );
      }).catch(() => undefined);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [pathname, registryRevision, session]);
  return null;
}
`;
}
