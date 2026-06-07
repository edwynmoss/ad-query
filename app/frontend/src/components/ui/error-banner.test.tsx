import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBanner } from "./error-banner";

describe("<ErrorBanner>", () => {
  it("shows a plain-language title + remedy and tucks the raw text under Details", () => {
    render(<ErrorBanner error={'dial tcp [::1]:389: connectex: No connection could be made'} />);
    expect(screen.getByText(/couldn't reach the directory/i)).toBeInTheDocument();
    expect(screen.getByText(/port/i)).toBeInTheDocument();
    // raw text present (inside the <details>)
    expect(screen.getByText(/connectex/)).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("renders nothing when there is no error", () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
