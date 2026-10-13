import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const features = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { getFeatures: features.get } }));

import PrivacyPage from "@/app/privacy/page";
import { Providers } from "@/components/providers";

function renderPolicy() {
  render(
    <Providers>
      <PrivacyPage />
    </Providers>
  );
  return screen.getByRole("article");
}

const headings = () => screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);

describe("privacy page", () => {
  beforeEach(() => {
    features.get.mockReset();
  });

  it("says what is kept, that it is not sold, and how to delete it", () => {
    features.get.mockResolvedValue({ chatbot: false, picks: true });
    const policy = renderPolicy();

    expect(screen.getByRole("heading", { name: "Privacy" })).toBeInTheDocument();
    expect(headings()).toEqual([
      "What is kept when you sign in",
      "Cookies",
      "How it is used",
      "Deleting your data",
    ]);
    expect(policy).not.toHaveTextContent(/chat/i);
    expect(policy).toHaveTextContent(/nothing is collected about visitors who do not sign in/);
    expect(policy).toHaveTextContent(/Your email address is not stored/);
    expect(policy).toHaveTextContent(/It is not sold/);
    expect(within(policy).getByRole("link", { name: "account page" })).toHaveAttribute(
      "href",
      "/account"
    );
    expect(within(policy).queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("covers chat only while chat is offered", async () => {
    features.get.mockResolvedValue({ chatbot: true, picks: true });
    const policy = renderPolicy();

    expect(await screen.findByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(policy).toHaveTextContent(/third-party AI model provider/);
    expect(policy).toHaveTextContent(/make picks or use chat\./);
    expect(policy).toHaveTextContent(/The text of a question is not stored/);
    expect(policy).toHaveTextContent(/your time zone, and applying the daily chat limit\./);
  });
});
