import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "./AiPanel";

describe("MarkdownMessage", () => {
  it("renders legacy evidence markers as plain paper locations instead of clickable chips", () => {
    render(
      <MarkdownMessage
        markdown={
          "The method improves routing [E935].\n\n## Evidence References\n\n- [E935] Rethinking On-Policy Distillation, p. 6, Methods, paragraph block 16; excerpt"
        }
      />,
    );

    expect(screen.queryByRole("button", { name: /E935/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/E935/)).not.toBeInTheDocument();
    expect(screen.getByText(/p\. 6, Methods, paragraph block 16/)).toBeInTheDocument();
  });

  it("centers standalone equation lines as display math", () => {
    const { container } = render(<MarkdownMessage markdown={"Loss:\n\nL(theta) = sum_i x_i"} />);

    const equation = container.querySelector(".katex-display");
    expect(equation).not.toBeNull();
    expect(equation).toHaveTextContent("L");
  });

  it("normalizes LaTeX markdown delimiters from model answers", () => {
    const { container } = render(
      <MarkdownMessage markdown={"输入 \\(\\mathbb{x} \\in \\mathbb{R}^{1 \\times C}\\) 被扩展。\n\n\\[\\mathbf{x}' = \\mathbf{x} \\oplus \\cdots\\]"} />,
    );

    expect(screen.queryByText(/\\\(/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector("code")).toBeNull();
  });

  it("renders screenshot-style Chinese prose with inline math as math instead of code chips", () => {
    const { container } = render(
      <MarkdownMessage markdown={"输入 \\(x_l \\in \\mathbb{R}^{1 \\times C}\\) 被扩展因子 \\(n\\) 扩展成 \\(X_l = (x_l,0)^\\top\\)，并通过 \\(H_l^{\\text{pre}}\\) 汇聚。"} />,
    );

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).not.toContain("\\(");
  });

  it("does not normalize LaTeX inside fenced code blocks", () => {
    const { container } = render(<MarkdownMessage markdown={"```tex\n\\(x_l\\)\n```\n\n正文 \\(x_l\\)"} />);

    expect(container.querySelector("pre code")).toHaveTextContent("\\(x_l\\)");
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("does not normalize LaTeX inside inline code", () => {
    const { container } = render(<MarkdownMessage markdown={"Keep `\\(x_l\\)` literal, render \\(x_l\\)."} />);

    expect(container.querySelector("code")).toHaveTextContent("\\(x_l\\)");
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("normalizes multi-line display LaTeX delimiters", () => {
    const { container } = render(<MarkdownMessage markdown={"\\[\nH_l = H_l^{\\text{pre}} + H_l^{\\text{post}}\n\\]"} />);

    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.textContent).not.toContain("\\[");
  });

  it("does not show the old citation lint warning", () => {
    render(<MarkdownMessage markdown={"这是一段较长的中文解读，用于确认界面不会在正常回答后面追加旧的证据引用警告。".repeat(3)} />);

    expect(screen.queryByText(/Some synthesis sentences/)).not.toBeInTheDocument();
  });
});
