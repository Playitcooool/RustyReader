import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents = {
  a: (props: ComponentProps<"a">) => <a {...props} rel="noreferrer" target="_blank" />,
  pre: (props: ComponentProps<"pre">) => <pre className="ai-markdown-pre" {...props} />,
  code({
    inline,
    className,
    children,
    ...props
  }: ComponentProps<"code"> & { inline?: boolean }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

function AiIcon({
  children,
  viewBox = "0 0 20 20",
}: {
  children: ReactNode;
  viewBox?: string;
}) {
  return (
    <svg aria-hidden="true" className="ai-icon" viewBox={viewBox}>
      {children}
    </svg>
  );
}

export const ChatHistoryIcon = () => (
  <AiIcon>
    <path
      d="M4 5.5h7.5A2.5 2.5 0 0 1 14 8v2A2.5 2.5 0 0 1 11.5 12.5H8l-3 2v-2H4A2.5 2.5 0 0 1 1.5 10V8A2.5 2.5 0 0 1 4 5.5Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <circle cx="15.25" cy="6.25" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M15.25 4.75v1.7l1.15.7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
  </AiIcon>
);

export const NewSessionIcon = () => (
  <AiIcon>
    <path
      d="M10 4v12M4 10h12"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    />
  </AiIcon>
);

export const ArtifactIcon = () => (
  <AiIcon>
    <path
      d="M6 2.5h5l3 3V16A1.5 1.5 0 0 1 12.5 17.5h-6A1.5 1.5 0 0 1 5 16V4A1.5 1.5 0 0 1 6.5 2.5Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path
      d="M11 2.5V6h3"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path
      d="M7.5 9.25h4.5M7.5 12h4.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.6"
    />
  </AiIcon>
);

export const TaskHistoryIcon = () => (
  <AiIcon>
    <rect x="3" y="3.5" width="14" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.6"
    />
  </AiIcon>
);

export const ResearchNotesIcon = () => (
  <AiIcon>
    <path
      d="M5 3.5h8A2 2 0 0 1 15 5.5v11l-4-2-4 2v-11A2 2 0 0 1 9 3.5Z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path
      d="M8 7.5h5M8 10.25h4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.6"
    />
  </AiIcon>
);

export const CloseCopilotIcon = () => (
  <AiIcon>
    <path
      d="m5 5 10 10M15 5 5 15"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    />
  </AiIcon>
);

export const DeleteSessionIcon = () => (
  <AiIcon>
    <path d="M8 5.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    <path d="M9 5.5l.75-1.5h.5L11 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    <path d="M5.5 7.5h9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    <path d="m7 7.5.75 8h4.5l.75-8" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
    <path d="M9.25 10.25v3M10.75 10.25v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
  </AiIcon>
);

export function MarkdownMessage({ markdown }: { markdown: string }) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
