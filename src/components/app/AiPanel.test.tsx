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

    const equation = container.querySelector(".ai-display-equation");
    expect(equation).not.toBeNull();
    expect(equation).toHaveTextContent("L(theta) = sum_i x_i");
  });

  it("does not show the old citation lint warning", () => {
    render(<MarkdownMessage markdown={"这是一段较长的中文解读，用于确认界面不会在正常回答后面追加旧的证据引用警告。".repeat(3)} />);

    expect(screen.queryByText(/Some synthesis sentences/)).not.toBeInTheDocument();
  });
});
