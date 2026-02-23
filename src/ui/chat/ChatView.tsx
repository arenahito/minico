import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type DragEvent as ReactDragEvent,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type { TurnStreamItem, TurnStreamState } from "../../core/chat/turnReducer";
import { ArrowDown, Check, ChevronDown, Copy, FolderOpen, ListPlus, Paperclip, Send, Square, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

export interface ComposerSelectOption {
  value: string;
  label: string;
}

interface ChatViewProps {
  turnState: TurnStreamState;
  items: TurnStreamItem[];
  threadLoading: boolean;
  threadCwd: string | null;
  selectedThreadPath?: string | null;
  composerValue: string;
  selectorLabel: string;
  selectorDisplay: string;
  selectorOptions: ComposerSelectOption[];
  selectorValue: string;
  busy: boolean;
  onComposerChange: (nextValue: string) => void;
  onSelectorChange: (nextValue: string) => boolean;
  onCreateThread: () => void;
  onSelectThreadPath?: (nextPath: string) => void;
  onSubmitPrompt: (composedPrompt: string) => void;
  onInterrupt: () => void;
}

interface ComposerAttachment {
  id: string;
  name: string;
  displayPath: string;
  uri: string;
  token: string;
  kind: "image" | "file";
  previewUrl: string | null;
}

interface ParsedMessageAttachment {
  key: string;
  name: string;
  displayPath: string;
  uri: string;
  kind: "image" | "file";
  previewUrl: string | null;
}

const USER_ATTACHMENT_TOKEN_PREFIX_RE = /^\[@([^\]]+)\]\((file:\/\/[^\s)]+)\)\s*/i;
const STREAM_BOTTOM_THRESHOLD_PX = 16;
const URL_LITERAL_RE = /https?:\/\/[^\s]+/g;
type MermaidRuntime = {
  initialize: (config: {
    startOnLoad: boolean;
    securityLevel: "strict";
    theme: "default" | "dark";
    suppressErrorRendering: boolean;
  }) => void;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

type MermaidImporter = () => Promise<{ default: MermaidRuntime }>;
const defaultMermaidImporter: MermaidImporter = () => import("mermaid");
type ChatViewTestGlobals = typeof globalThis & {
  __MINICO_MERMAID_IMPORTER__?: MermaidImporter | null;
};

let mermaidRuntime: MermaidRuntime | null = null;
let mermaidLoader: Promise<MermaidRuntime> | null = null;
const mermaidImporter: MermaidImporter = defaultMermaidImporter;

async function loadMermaid() {
  const testImporter = (globalThis as ChatViewTestGlobals).__MINICO_MERMAID_IMPORTER__;
  if (testImporter) {
    const module = await testImporter();
    return module.default;
  }

  if (mermaidRuntime) {
    return mermaidRuntime;
  }

  if (!mermaidLoader) {
    mermaidLoader = mermaidImporter()
      .then((module) => {
        mermaidRuntime = module.default;
        return mermaidRuntime;
      })
      .catch((error) => {
        mermaidLoader = null;
        throw error;
      });
  }

  return mermaidLoader;
}

function isStreamAtBottom(element: HTMLElement): boolean {
  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceToBottom <= STREAM_BOTTOM_THRESHOLD_PX;
}

function splitTrailingPunctuation(urlLiteral: string): { url: string; trailing: string } {
  let url = urlLiteral;
  let trailing = "";

  while (url.length > 0) {
    const lastChar = url.slice(-1);
    if (!/[),.!?:;"'\]]/.test(lastChar)) {
      break;
    }
    if (lastChar === ")") {
      const openCount = (url.match(/\(/g) ?? []).length;
      const closeCount = (url.match(/\)/g) ?? []).length;
      if (closeCount <= openCount) {
        break;
      }
    }
    if (lastChar === "]") {
      const openCount = (url.match(/\[/g) ?? []).length;
      const closeCount = (url.match(/\]/g) ?? []).length;
      if (closeCount <= openCount) {
        break;
      }
    }
    trailing = `${lastChar}${trailing}`;
    url = url.slice(0, -1);
  }

  return { url, trailing };
}

function renderTextWithAutoLinks(text: string, keyPrefix = "auto-link"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_LITERAL_RE)) {
    const raw = match[0];
    const index = match.index ?? -1;
    if (!raw || index < 0) {
      continue;
    }
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    const { url, trailing } = splitTrailingPunctuation(raw);
    if (url.length > 0) {
      nodes.push(
        <a
          key={`${keyPrefix}-${index}-${url}`}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {url}
        </a>,
      );
    }
    if (trailing.length > 0) {
      nodes.push(trailing);
    }
    cursor = index + raw.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderCodeChildrenWithAutoLinks(children: ReactNode, keyPrefix: string): ReactNode {
  if (typeof children === "string" || typeof children === "number") {
    return renderTextWithAutoLinks(String(children), `${keyPrefix}-text`);
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => renderCodeChildrenWithAutoLinks(child, `${keyPrefix}-${index}`));
  }

  if (!isValidElement<{ children?: ReactNode }>(children)) {
    return children;
  }

  if (children.type === "a") {
    return children;
  }

  const originalChildren = children.props.children;
  if (originalChildren === undefined) {
    return children;
  }

  return cloneElement(
    children,
    undefined,
    renderCodeChildrenWithAutoLinks(originalChildren, `${keyPrefix}-child`),
  );
}

function collectTextFromHastNode(node: unknown): string {
  if (node == null) {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (typeof node !== "object") {
    return "";
  }

  const candidate = node as {
    value?: unknown;
    children?: unknown[];
  };

  if (typeof candidate.value === "string") {
    return candidate.value;
  }

  if (!Array.isArray(candidate.children)) {
    return "";
  }

  return candidate.children.map((child) => collectTextFromHastNode(child)).join("");
}

function resolveMermaidSource(node: unknown): string | null {
  if (node == null || typeof node !== "object") {
    return null;
  }

  const preNode = node as {
    children?: Array<{
      tagName?: unknown;
      properties?: { className?: unknown };
      children?: unknown[];
    }>;
  };

  const codeNode = preNode.children?.find((child) => child?.tagName === "code");
  if (!codeNode) {
    return null;
  }

  const classNameValue = codeNode.properties?.className;
  const className = Array.isArray(classNameValue)
    ? classNameValue.map((entry) => String(entry)).join(" ")
    : typeof classNameValue === "string"
      ? classNameValue
      : "";

  if (!/\blanguage-mermaid\b/i.test(className)) {
    return null;
  }

  return collectTextFromHastNode(codeNode).trim();
}

interface PreCodeNodeInfo {
  className: string;
  source: string;
}

function resolvePreCodeNodeInfo(node: unknown): PreCodeNodeInfo | null {
  if (node == null || typeof node !== "object") {
    return null;
  }

  const preNode = node as {
    children?: Array<{
      tagName?: unknown;
      properties?: { className?: unknown };
      children?: unknown[];
    }>;
  };

  const codeNode = preNode.children?.find((child) => child?.tagName === "code");
  if (!codeNode) {
    return null;
  }

  const classNameValue = codeNode.properties?.className;
  const className = Array.isArray(classNameValue)
    ? classNameValue.map((entry) => String(entry)).join(" ")
    : typeof classNameValue === "string"
      ? classNameValue
      : "";

  return {
    className,
    source: collectTextFromHastNode(codeNode),
  };
}

function normalizeCodeBlockSource(source: string): string {
  const normalizedLineEndings = source.replace(/\r\n/g, "\n");
  return normalizedLineEndings.replace(/\n$/, "");
}

function isMultilineCodeBlock(source: string): boolean {
  return normalizeCodeBlockSource(source).includes("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API is unavailable.");
  }

  const element = document.createElement("textarea");
  element.value = text;
  element.setAttribute("readonly", "true");
  element.style.position = "fixed";
  element.style.opacity = "0";
  document.body.appendChild(element);
  element.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(element);
  if (!copied) {
    throw new Error("Failed to copy text.");
  }
}

function readMermaidTheme(): "default" | "dark" {
  if (typeof document === "undefined") {
    return "default";
  }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"default" | "dark">(() => readMermaidTheme());
  const diagramId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindFunctionsRef = useRef<((element: Element) => void) | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const showCopyButton = source.length > 0 && isMultilineCodeBlock(source);

  useEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setTheme(readMermaidTheme());
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    bindFunctionsRef.current = null;
    if (source.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const renderDiagram = async () => {
      try {
        const mermaid = await loadMermaid();
        if (cancelled) {
          return;
        }
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme,
          suppressErrorRendering: true,
        });
        const renderId = `${diagramId}-${Date.now()}`;
        const { svg: renderedSvg, bindFunctions } = await mermaid.render(renderId, source);
        if (cancelled) {
          return;
        }
        bindFunctionsRef.current = typeof bindFunctions === "function" ? bindFunctions : null;
        setSvg(renderedSvg);
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSvg(null);
        bindFunctionsRef.current = null;
        setErrorMessage(error instanceof Error ? error.message : "Failed to render Mermaid diagram.");
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [diagramId, source, theme]);

  useEffect(() => {
    if (!svg || !containerRef.current || !bindFunctionsRef.current) {
      return;
    }
    bindFunctionsRef.current(containerRef.current);
  }, [svg]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!showCopyButton) {
      return;
    }
    try {
      await copyTextToClipboard(source);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1200);
    } catch {
      setCopied(false);
    }
  }, [showCopyButton, source]);

  return (
    <div className={`chat-code-block-wrap chat-mermaid-wrap${showCopyButton ? " has-copy" : ""}`}>
      {showCopyButton ? (
        <button
          type="button"
          className="chat-code-copy-button"
          onClick={() => void handleCopy()}
          aria-label={copied ? "Code copied" : "Copy code block"}
          title={copied ? "Code copied" : "Copy code"}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      ) : null}
      {source.length === 0 || errorMessage ? (
        <div className="chat-mermaid chat-mermaid-error" role="status">
          <p className="chat-mermaid-error-label">
            {source.length === 0 ? "Mermaid diagram is empty." : "Failed to render Mermaid diagram."}
          </p>
          <pre className="chat-mermaid-error-source">
            <code>{source}</code>
          </pre>
        </div>
      ) : (
        <div className="chat-mermaid" role="img" aria-label="Mermaid diagram">
          {svg ? (
            <div
              ref={containerRef}
              className="chat-mermaid-svg"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="chat-mermaid-loading">Rendering diagram...</p>
          )}
        </div>
      )}
    </div>
  );
}

function CopyableCodeBlock({
  children,
  node,
  preProps,
}: {
  children: ReactNode;
  node: unknown;
  preProps: ComponentPropsWithoutRef<"pre">;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const codeInfo = useMemo(() => resolvePreCodeNodeInfo(node), [node]);
  const source = useMemo(
    () => normalizeCodeBlockSource(codeInfo?.source ?? ""),
    [codeInfo?.source],
  );
  const showCopyButton = source.length > 0 && isMultilineCodeBlock(source);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!showCopyButton) {
      return;
    }
    try {
      await copyTextToClipboard(source);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1200);
    } catch {
      setCopied(false);
    }
  }, [showCopyButton, source]);

  return (
    <div className={`chat-code-block-wrap${showCopyButton ? " has-copy" : ""}`}>
      {showCopyButton ? (
        <button
          type="button"
          className="chat-code-copy-button"
          onClick={() => void handleCopy()}
          aria-label={copied ? "Code copied" : "Copy code block"}
          title={copied ? "Code copied" : "Copy code"}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      ) : null}
      <pre {...preProps}>{children}</pre>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children, node, ...props }) {
    const mermaidSource = resolveMermaidSource(node);
    if (mermaidSource !== null) {
      return <MermaidDiagram source={mermaidSource} />;
    }
    return <CopyableCodeBlock children={children} node={node} preProps={props} />;
  },
  code({ children, className, ...props }) {
    const childNodes = Children.toArray(children);
    const plainTextOnly = childNodes.every(
      (child) => typeof child === "string" || typeof child === "number",
    );
    const textContent = plainTextOnly ? childNodes.map((child) => String(child)).join("") : "";
    const hasLanguageClass = typeof className === "string" && /\blanguage-/.test(className);
    const isInline = plainTextOnly && !hasLanguageClass && !textContent.includes("\n");
    if (isInline) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    if (!plainTextOnly) {
      return (
        <code className={className} {...props}>
          {renderCodeChildrenWithAutoLinks(children, "code")}
        </code>
      );
    }
    const content = textContent;
    return (
      <code className={className} {...props}>
        {renderTextWithAutoLinks(content)}
      </code>
    );
  },
};

function isImageName(name: string): boolean {
  return /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|webp)$/i.test(name);
}

function nameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const candidate = parts[parts.length - 1] ?? "";
  if (candidate.length > 0) {
    return candidate;
  }
  return path;
}

function normalizeExtendedPath(path: string): string {
  return path.replace(/^\\\\\?\\/, "");
}

function toFileUri(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).toString();
    } catch {
      return encodeURI(trimmed);
    }
  }

  const normalized = normalizeExtendedPath(trimmed).replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return new URL(`file:///${normalized}`).toString();
  }
  if (normalized.startsWith("//")) {
    return new URL(`file:${normalized}`).toString();
  }
  if (normalized.startsWith("/")) {
    return new URL(`file://${normalized}`).toString();
  }
  return encodeURI(normalized);
}

function displayPathFromSelection(selection: string): string {
  if (!/^file:\/\//i.test(selection)) {
    return selection;
  }

  try {
    const url = new URL(selection);
    if (url.protocol !== "file:") {
      return selection;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//.test(pathname)) {
      pathname = pathname.slice(1);
    }
    if (/^[a-zA-Z]:\//.test(pathname)) {
      return normalizeExtendedPath(pathname.replace(/\//g, "\\"));
    }
    return normalizeExtendedPath(pathname);
  } catch {
    return normalizeExtendedPath(selection);
  }
}

function assetPathFromSelection(selection: string): string {
  const displayPath = displayPathFromSelection(selection);
  if (/^[a-zA-Z]:\\/.test(displayPath)) {
    return displayPath.replace(/\\/g, "/");
  }
  return displayPath;
}

function previewUrlFromPath(kind: "image" | "file", sourcePath: string, uri: string): string | null {
  if (kind !== "image") {
    return null;
  }
  try {
    return convertFileSrc(sourcePath);
  } catch {
    return uri;
  }
}

function releaseAttachmentPreview(attachment: ComposerAttachment): void {
  if (!attachment.previewUrl) {
    return;
  }
  if (!attachment.previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(attachment.previewUrl);
}

function createAttachmentFromSelection(selection: string): ComposerAttachment {
  const sourcePath = assetPathFromSelection(selection);
  const displayPath = displayPathFromSelection(selection);
  const uri = toFileUri(sourcePath);
  const name = nameFromPath(displayPath);
  const kind = isImageName(name) ? "image" : "file";
  const previewUrl = previewUrlFromPath(kind, sourcePath, uri);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    displayPath,
    uri,
    token: `[@${name}](${uri})`,
    kind,
    previewUrl,
  };
}

function parseMessageAttachmentPrefix(text: string): {
  attachments: ParsedMessageAttachment[];
  bodyText: string;
} {
  const attachments: ParsedMessageAttachment[] = [];
  let rest = text.trimStart();
  let guard = 0;

  while (guard < 64) {
    const matched = rest.match(USER_ATTACHMENT_TOKEN_PREFIX_RE);
    if (!matched) {
      break;
    }
    const [, rawName = "", rawUri = ""] = matched;
    const uri = toFileUri(rawUri);
    const displayPath = displayPathFromSelection(uri);
    const sourcePath = assetPathFromSelection(uri);
    const fallbackName = nameFromPath(displayPath);
    const name = rawName.length > 0 ? rawName : fallbackName;
    const kind = isImageName(name) || isImageName(displayPath) ? "image" : "file";

    attachments.push({
      key: `${uri}:${attachments.length}`,
      name,
      displayPath,
      uri,
      kind,
      previewUrl: previewUrlFromPath(kind, sourcePath, uri),
    });

    rest = rest.slice(matched[0].length);
    guard += 1;
  }

  return {
    attachments,
    bodyText: rest.trimStart(),
  };
}

function hasFileDataTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  if (dataTransfer.files.length > 0) {
    return true;
  }
  return Array.from(dataTransfer.types).some((type) => type === "Files");
}

function filePathFromDroppedFile(file: File): string | null {
  const maybeWithPath = file as File & { path?: string };
  if (typeof maybeWithPath.path === "string" && maybeWithPath.path.trim().length > 0) {
    return maybeWithPath.path.trim();
  }
  return null;
}

function parseUriListEntries(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .filter((line) => /^file:\/\//i.test(line));
}

function extractSelectionsFromDataTransfer(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) {
    return [];
  }

  const selections = new Set<string>();
  const files = Array.from(dataTransfer.files);
  files
    .map(filePathFromDroppedFile)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .forEach((value) => selections.add(value));

  const uriList = dataTransfer.getData("text/uri-list");
  parseUriListEntries(uriList).forEach((value) => selections.add(value));

  const plainText = dataTransfer.getData("text/plain").trim();
  if (/^file:\/\//i.test(plainText)) {
    selections.add(plainText);
  }

  return Array.from(selections);
}

export function ChatView({
  turnState,
  items,
  threadLoading,
  threadCwd,
  selectedThreadPath = null,
  composerValue,
  selectorLabel,
  selectorDisplay,
  selectorOptions,
  selectorValue,
  busy,
  onComposerChange,
  onSelectorChange,
  onCreateThread,
  onSelectThreadPath,
  onSubmitPrompt,
  onInterrupt,
}: ChatViewProps) {
  const selectorRootRef = useRef<HTMLDivElement | null>(null);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  const streamAtBottomRef = useRef(true);
  const wasBusyRef = useRef(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [streamAtBottom, setStreamAtBottom] = useState(true);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const composedPrompt = useMemo(() => {
    const tokens = attachments.map((attachment) => attachment.token);
    const prompt = composerValue.trim();
    if (tokens.length === 0) {
      return prompt;
    }
    if (prompt.length === 0) {
      return tokens.join(" ");
    }
    return `${tokens.join(" ")} ${prompt}`;
  }, [attachments, composerValue]);
  const canSubmit = !busy && composedPrompt.trim().length > 0;
  const resolvedThreadCwd = threadCwd ?? "(resolving cwd...)";
  const displayedThreadCwd = selectedThreadPath
    ? `${selectedThreadPath} (${resolvedThreadCwd})`
    : resolvedThreadCwd;
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const text = item.text.trim();
        if (item.role === "user" && text.length === 0) {
          return false;
        }
        if (item.role === "agent" && text.length === 0) {
          return false;
        }
        if (item.completed && text.length === 0) {
          return false;
        }
        return true;
      }),
    [items],
  );
  const renderedItems = useMemo(
    () => (threadLoading ? [] : visibleItems),
    [threadLoading, visibleItems],
  );
  const hasPendingAgentItem = renderedItems.some(
    (item) => item.role === "agent" && !item.completed,
  );
  const showAgentTypingIndicator =
    !threadLoading && Boolean(turnState.activeTurnId) && !hasPendingAgentItem;
  const showEmptyPlaceholder = renderedItems.length === 0 && !showAgentTypingIndicator;
  const showScrollToBottomButton = !threadLoading && renderedItems.length > 0 && !streamAtBottom;
  const imageAttachments = attachments.filter(
    (attachment) => attachment.kind === "image",
  );
  const fileAttachments = attachments.filter(
    (attachment) => attachment.kind === "file",
  );

  const appendAttachmentsFromSelections = useCallback((selections: string[]): void => {
    const normalizedSelections = selections
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (normalizedSelections.length === 0) {
      return;
    }

    const nextAttachments = normalizedSelections.map(createAttachmentFromSelection);
    if (nextAttachments.length === 0) {
      return;
    }

    setAttachments((current) => {
      const existingUris = new Set(current.map((attachment) => attachment.uri));
      const unique: ComposerAttachment[] = [];
      const duplicates: ComposerAttachment[] = [];
      nextAttachments.forEach((attachment) => {
        if (existingUris.has(attachment.uri)) {
          duplicates.push(attachment);
          return;
        }
        existingUris.add(attachment.uri);
        unique.push(attachment);
      });
      duplicates.forEach(releaseAttachmentPreview);
      if (unique.length === 0) {
        return current;
      }
      return [...current, ...unique];
    });
  }, []);

  async function handlePickFile(): Promise<void> {
    try {
      const picked = await open({
        multiple: true,
        directory: false,
      });
      if (!picked) {
        return;
      }

      const selected = Array.isArray(picked) ? picked : [picked];
      const selections = selected.filter((entry): entry is string => typeof entry === "string");
      appendAttachmentsFromSelections(selections);
    } catch (error) {
      console.warn("file picker failed", error);
    }
  }

  async function handlePickThreadPath(): Promise<void> {
    if (!onSelectThreadPath) {
      return;
    }
    const defaultThreadPath =
      selectedThreadPath?.trim().length
        ? selectedThreadPath.trim()
        : threadCwd?.trim().length
          ? threadCwd.trim()
          : undefined;
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultThreadPath,
      });
      if (!picked) {
        return;
      }
      const selected = Array.isArray(picked) ? picked[0] : picked;
      if (typeof selected !== "string") {
        return;
      }
      const normalized = selected.trim();
      if (normalized.length === 0) {
        return;
      }
      onSelectThreadPath(normalized);
    } catch (error) {
      console.warn("thread path picker failed", error);
    }
  }

  function handleDragEnter(event: ReactDragEvent<HTMLElement>): void {
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setDropActive(true);
  }

  function handleDragOver(event: ReactDragEvent<HTMLElement>): void {
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dropActive) {
      setDropActive(true);
    }
  }

  function handleDragLeave(event: ReactDragEvent<HTMLElement>): void {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setDropActive(false);
  }

  function handleDrop(event: ReactDragEvent<HTMLElement>): void {
    setDropActive(false);
    if (!hasFileDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    const selections = extractSelectionsFromDataTransfer(event.dataTransfer);
    appendAttachmentsFromSelections(selections);
  }

  function removeAttachmentById(attachmentId: string): void {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === attachmentId);
      if (target) {
        releaseAttachmentPreview(target);
      }
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  function clearAttachments(): void {
    setAttachments((current) => {
      current.forEach(releaseAttachmentPreview);
      return [];
    });
  }

  const syncStreamBottomState = useCallback((): void => {
    const stream = chatStreamRef.current;
    if (!stream) {
      return;
    }
    const atBottom = isStreamAtBottom(stream);
    streamAtBottomRef.current = atBottom;
    setStreamAtBottom((current) => (current === atBottom ? current : atBottom));
  }, []);

  const scrollToLatestMessage = useCallback(
    (behavior: ScrollBehavior): void => {
      const stream = chatStreamRef.current;
      if (!stream) {
        return;
      }
      const nextTop = stream.scrollHeight;
      if (typeof stream.scrollTo === "function") {
        stream.scrollTo({ top: nextTop, behavior });
      } else {
        stream.scrollTop = nextTop;
      }
      streamAtBottomRef.current = true;
      setStreamAtBottom(true);
    },
    [],
  );

  const handleChatStreamScroll = useCallback((): void => {
    syncStreamBottomState();
  }, [syncStreamBottomState]);

  useEffect(() => {
    function handleOutsidePointer(event: MouseEvent): void {
      if (!selectorRootRef.current) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!selectorRootRef.current.contains(target)) {
        setSelectorOpen(false);
      }
    }

    window.addEventListener("mousedown", handleOutsidePointer);
    return () => {
      window.removeEventListener("mousedown", handleOutsidePointer);
    };
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (
      wasBusyRef.current &&
      !busy &&
      composerValue.trim().length === 0 &&
      attachments.length > 0
    ) {
      queueMicrotask(() => {
        clearAttachments();
      });
    }
    wasBusyRef.current = busy;
  }, [attachments.length, busy, composerValue]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(releaseAttachmentPreview);
    };
  }, []);

  useEffect(() => {
    if (threadLoading) {
      streamAtBottomRef.current = true;
      queueMicrotask(() => {
        setStreamAtBottom(true);
      });
      return;
    }
    syncStreamBottomState();
  }, [syncStreamBottomState, threadLoading]);

  useEffect(() => {
    if (threadLoading) {
      return;
    }
    if (streamAtBottomRef.current) {
      queueMicrotask(() => {
        scrollToLatestMessage("auto");
      });
      return;
    }
    syncStreamBottomState();
  }, [renderedItems, scrollToLatestMessage, showAgentTypingIndicator, syncStreamBottomState, threadLoading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const tauriWindow = window as Window & { __TAURI_INTERNALS__?: unknown };
    if (!tauriWindow.__TAURI_INTERNALS__) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDropActive(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDropActive(false);
          return;
        }
        if (event.payload.type === "drop") {
          setDropActive(false);
          appendAttachmentsFromSelections(event.payload.paths);
        }
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("drag drop listener setup failed", error);
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [appendAttachmentsFromSelections]);

  return (
    <section
      className={`chat-view ${dropActive ? "is-drop-target" : ""}`}
      aria-label="chat view"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {threadLoading ? (
        <div className="chat-pane-loading" role="status" aria-live="polite">
          <img
            className="chat-pane-loading-image"
            src="/minico500x500.png"
            alt="Loading selected thread"
          />
          <p className="chat-pane-loading-text">Loading selected thread...</p>
        </div>
      ) : (
        <>
          <div className="chat-stream-wrap">
            <div
              ref={chatStreamRef}
              className={`chat-stream ${showEmptyPlaceholder ? "is-empty" : ""}`}
              aria-live="polite"
              aria-label="chat messages"
              onScroll={handleChatStreamScroll}
            >
              {renderedItems.map((item) => {
                const parsedUserMessage =
                  item.role === "user" ? parseMessageAttachmentPrefix(item.text) : null;
                const userImageAttachments = parsedUserMessage
                  ? parsedUserMessage.attachments.filter((attachment) => attachment.kind === "image")
                  : [];
                const userFileAttachments = parsedUserMessage
                  ? parsedUserMessage.attachments.filter((attachment) => attachment.kind === "file")
                  : [];

                return (
                  <article
                    key={item.id}
                    className={`chat-item ${item.role === "user" ? "chat-item-user" : "chat-item-agent"}`}
                  >
                    {item.role === "user" ? (
                      <div className="chat-user-message">
                        {userImageAttachments.length > 0 ? (
                          <div className="chat-item-image-attachments" aria-label="Message image attachments">
                            {userImageAttachments.map((attachment) => (
                              <article key={attachment.key} className="chat-item-image-attachment">
                                <img
                                  src={attachment.previewUrl ?? ""}
                                  alt={attachment.name}
                                  onError={(event) => {
                                    const target = event.currentTarget;
                                    if (target.dataset.fallbackApplied === "true") {
                                      return;
                                    }
                                    target.dataset.fallbackApplied = "true";
                                    target.src = attachment.uri;
                                  }}
                                />
                              </article>
                            ))}
                          </div>
                        ) : null}
                        {userFileAttachments.length > 0 ? (
                          <div className="chat-item-inline-file-blocks" aria-label="Message file attachments">
                            {userFileAttachments.map((attachment) => (
                              <article key={attachment.key} className="chat-item-inline-file-block">
                                <Paperclip size={14} aria-hidden="true" />
                                <code title={attachment.displayPath}>{attachment.displayPath}</code>
                              </article>
                            ))}
                          </div>
                        ) : null}
                        {parsedUserMessage && parsedUserMessage.bodyText.length > 0 ? (
                          <p className="chat-item-body">
                            {renderTextWithAutoLinks(parsedUserMessage.bodyText)}
                          </p>
                        ) : null}
                        {!parsedUserMessage ||
                        (parsedUserMessage.attachments.length === 0 &&
                          parsedUserMessage.bodyText.length === 0) ? (
                          <p className="chat-item-body">...</p>
                        ) : null}
                      </div>
                    ) : (
                      <>
                      <img className="chat-agent-avatar" src="/minico500x500.png" alt="minico" />
                      <div className="chat-item-body chat-item-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                          components={markdownComponents}
                        >
                          {item.text || "..."}
                        </ReactMarkdown>
                      </div>
                    </>
                  )}
                    {!item.completed ? (
                      <footer className="chat-item-meta">
                        {item.role === "agent" ? (
                          <span className="typing-dots typing-dots-inline" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : null}
                        <span className="chat-item-state">minico is thinking...</span>
                      </footer>
                    ) : null}
                  </article>
                );
              })}
              {showAgentTypingIndicator ? (
                <article
                  className="chat-item chat-item-agent chat-item-typing"
                  aria-label="minico thinking indicator"
                >
                  <img className="chat-agent-avatar" src="/minico500x500.png" alt="minico" />
                  <div className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="typing-label">minico is thinking...</p>
                </article>
              ) : null}
              {showEmptyPlaceholder ? (
                <div className="chat-empty-placeholder">
                  <img
                    className="chat-empty-image"
                    src="/minico500x500.png"
                    alt="minico"
                  />
                  <p className="chat-empty-bubble">Ask me anything</p>
                </div>
              ) : null}
            </div>
            {showScrollToBottomButton ? (
              <button
                type="button"
                className="icon-button icon-button-muted chat-scroll-to-bottom"
                onClick={() => scrollToLatestMessage("smooth")}
                aria-label="Scroll to latest messages"
                title="Scroll to latest messages"
              >
                <ArrowDown size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="composer">
            <div className="chat-turn-cwd-row">
              <button
                type="button"
                className="icon-button icon-button-muted chat-turn-cwd-picker"
                onClick={() => void handlePickThreadPath()}
                aria-label="Select thread cwd"
                title="Select thread cwd"
              >
                <FolderOpen size={16} aria-hidden="true" />
              </button>
              <p className="chat-turn-cwd" title={displayedThreadCwd}>
                <code>{displayedThreadCwd}</code>
              </p>
            </div>
            {imageAttachments.length > 0 ? (
              <div className="composer-image-attachments" aria-label="Image attachments">
                {imageAttachments.map((attachment) => (
                  <article key={attachment.id} className="composer-image-attachment">
                    <img
                      src={attachment.previewUrl ?? ""}
                      alt={attachment.name}
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (target.dataset.fallbackApplied === "true") {
                          return;
                        }
                        target.dataset.fallbackApplied = "true";
                        target.src = attachment.uri;
                      }}
                    />
                    <button
                      type="button"
                      className="composer-attachment-remove"
                      onClick={() => removeAttachmentById(attachment.id)}
                      aria-label={`Remove ${attachment.name}`}
                      title="Remove attachment"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            {fileAttachments.length > 0 ? (
              <div className="composer-inline-file-blocks" aria-label="File attachments">
                {fileAttachments.map((attachment) => (
                  <article key={attachment.id} className="composer-inline-file-block">
                    <Paperclip size={14} aria-hidden="true" />
                    <code title={attachment.displayPath}>{attachment.displayPath}</code>
                    <button
                      type="button"
                      className="composer-attachment-remove"
                      onClick={() => removeAttachmentById(attachment.id)}
                      aria-label={`Remove ${attachment.name}`}
                      title="Remove attachment"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            <textarea
              id="promptInput"
              value={composerValue}
              onChange={(event) => onComposerChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !event.ctrlKey) {
                  return;
                }
                if (!canSubmit) {
                  return;
                }
                event.preventDefault();
                onSubmitPrompt(composedPrompt);
              }}
              placeholder="Ask me anything"
              rows={4}
            />
            <div className="composer-toolbar">
              <div className="composer-left-controls">
                <button
                  type="button"
                  className="icon-button icon-button-muted"
                  onClick={() => void handlePickFile()}
                  aria-label="Add file"
                  title="Add file"
                >
                  <Paperclip size={16} aria-hidden="true" />
                </button>
                <div className="model-select" ref={selectorRootRef}>
                  <button
                    type="button"
                    className="model-select-trigger"
                    aria-label={selectorLabel}
                    aria-haspopup="listbox"
                    aria-expanded={selectorOpen}
                    onClick={() => setSelectorOpen((current) => !current)}
                  >
                    <span className="model-select-value">{selectorDisplay}</span>
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {selectorOpen ? (
                    <ul className="model-select-menu" role="listbox" aria-label={selectorLabel}>
                      {selectorOptions.map((option) => (
                        <li key={option.value}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selectorValue === option.value}
                            className="model-select-option"
                            onClick={() => {
                              const shouldClose = onSelectorChange(option.value);
                              if (shouldClose) {
                                setSelectorOpen(false);
                              }
                            }}
                          >
                            {option.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              <div className="composer-actions">
                <button
                  type="button"
                  className="icon-button icon-button-muted"
                  onClick={onCreateThread}
                  aria-label="Create new thread"
                  title="New thread"
                >
                  <ListPlus size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button-muted"
                  onClick={onInterrupt}
                  disabled={!turnState.activeTurnId || busy}
                  aria-label="Interrupt turn"
                  title="Interrupt turn"
                >
                  <Square size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button-primary"
                  onClick={() => onSubmitPrompt(composedPrompt)}
                  disabled={!canSubmit}
                  aria-label={busy ? "Sending prompt" : "Send prompt"}
                  title={busy ? "Sending..." : "Send"}
                >
                  <Send size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
