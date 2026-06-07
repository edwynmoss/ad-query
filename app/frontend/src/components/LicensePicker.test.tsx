import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LicensePicker } from "./LicensePicker";
import { m365 } from "../../wailsjs/go/models";

const sku = (product: string, assigned: number) => m365.LicenseSku.createFrom({ product, skuPartNumber: product, purchased: assigned, assigned, available: 0 });
const SKUS = [sku("Microsoft 365 E3", 231), sku("Microsoft 365 E5", 44)];

describe("<LicensePicker>", () => {
  it("selecting a SKU adds it; 'All licenses' clears the selection", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<LicensePicker skus={SKUS} selected={[]} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Microsoft 365 E3/ }));
    expect(onChange).toHaveBeenLastCalledWith(["Microsoft 365 E3"]);

    rerender(<LicensePicker skus={SKUS} selected={["Microsoft 365 E3"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /All licenses/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("toggling an already-selected SKU removes it", async () => {
    const onChange = vi.fn();
    render(<LicensePicker skus={SKUS} selected={["Microsoft 365 E3", "Microsoft 365 E5"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Microsoft 365 E3/ }));
    expect(onChange).toHaveBeenLastCalledWith(["Microsoft 365 E5"]);
  });
});
