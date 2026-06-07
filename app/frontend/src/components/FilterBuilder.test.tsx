import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterBuilder } from "./FilterBuilder";
import { newCondition } from "../lib/filterBuilder";

describe("<FilterBuilder>", () => {
  it("'Add condition' appends an empty condition via onChange", async () => {
    const onChange = vi.fn();
    render(<FilterBuilder conditions={[]} matchOp="and" attributes={["cn", "mail"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Add condition/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [conds, op] = onChange.mock.calls[0];
    expect(conds).toHaveLength(1);
    expect(op).toBe("and");
  });

  it("removing a condition drops it from the set", async () => {
    const onChange = vi.fn();
    const c = newCondition();
    render(<FilterBuilder conditions={[c]} matchOp="and" attributes={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /remove condition/ }));
    expect(onChange).toHaveBeenLastCalledWith([], "and");
  });

  it("shows the plain-language empty message when there are no conditions", () => {
    render(<FilterBuilder conditions={[]} matchOp="and" attributes={[]} onChange={() => {}} />);
    expect(screen.getByText(/No conditions/i)).toBeInTheDocument();
  });
});
