import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const features = vi.hoisted(() => ({ get: vi.fn() }));
const actionState = vi.hoisted(() => ({
  current: { status: "idle" } as
    | { status: "idle" }
    | { status: "sent" }
    | { status: "off" }
    | { status: "error"; message: string },
  pending: false,
}));

vi.mock("@/lib/api", () => ({ api: { getFeatures: features.get } }));
// The real action imports NextAuth, which cannot load under jsdom.
vi.mock("@/app/feedback/actions", () => ({ sendFeedbackAction: vi.fn() }));
// Never submitted here, so stub the hook to render each result.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), actionState.pending],
  };
});

import FeedbackPage from "@/app/feedback/page";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { Providers } from "@/components/providers";
import { CONTACT_EMAIL } from "@/lib/contact";

function renderForm(props: Partial<Parameters<typeof FeedbackForm>[0]> = {}) {
  return render(
    <Providers>
      <FeedbackForm kind="other" pagePath={null} {...props} />
    </Providers>
  );
}

beforeEach(() => {
  features.get.mockReset();
  features.get.mockResolvedValue({ feedback: true });
  actionState.current = { status: "idle" };
  actionState.pending = false;
});

describe("FeedbackForm", () => {
  it("preselects the kind and carries the page and an empty honeypot", () => {
    const { container } = renderForm({ kind: "data", pagePath: "/data" });
    expect(screen.getByRole("radio", { name: "A wrong number" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "An idea" })).not.toBeChecked();
    expect(container.querySelector('input[name="page_path"]')).toHaveValue("/data");
    const honeypot = container.querySelector('input[name="website"]');
    expect(honeypot).toHaveValue("");
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByLabelText("What happened?")).toBeRequired();
    expect(screen.getByLabelText(/Email/)).not.toBeRequired();
  });

  it("counts characters and lets the kind change", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("What happened?"), {
      target: { value: "Standings never load." },
    });
    expect(screen.getByText("21/2000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Something is broken" }));
    expect(screen.getByRole("radio", { name: "Something is broken" })).toBeChecked();
  });

  it("shows a refused send and disables the button while sending", () => {
    actionState.current = { status: "error", message: "Try again a little later." };
    actionState.pending = true;
    renderForm();
    expect(screen.getByRole("alert")).toHaveTextContent("Try again a little later.");
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  });

  it("thanks the sender once it is sent", () => {
    actionState.current = { status: "sent" };
    renderForm();
    expect(screen.getByRole("status")).toHaveTextContent("Thanks, got it.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the email address when the form is off", async () => {
    features.get.mockResolvedValue({ feedback: false });
    renderForm();
    const link = await screen.findByRole("link", { name: CONTACT_EMAIL });
    expect(link).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("offers the email address when the API says it is closed", () => {
    actionState.current = { status: "off" };
    renderForm();
    expect(screen.getByText(/The form is closed right now/)).toBeInTheDocument();
  });
});

describe("feedback page", () => {
  it("reads the kind and page from the query and drops an off-site page", async () => {
    render(
      <Providers>
        {await FeedbackPage({
          searchParams: Promise.resolve({ kind: "data", from: "/teams/gsw" }),
        })}
      </Providers>
    );
    expect(screen.getByRole("heading", { name: "Feedback" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "A wrong number" })).toBeChecked();
    expect(screen.getByRole("link", { name: "/teams/gsw" })).toHaveAttribute("href", "/teams/gsw");
    const article = screen.getByRole("article");
    expect(within(article).getByRole("link", { name: "privacy page" })).toHaveAttribute(
      "href",
      "/privacy"
    );
  });

  it("ignores an unknown kind and a page off the site", async () => {
    render(
      <Providers>
        {await FeedbackPage({
          searchParams: Promise.resolve({ kind: "rant", from: "//evil.example" }),
        })}
      </Providers>
    );
    expect(screen.getByRole("radio", { name: "Something else" })).toBeChecked();
    expect(screen.queryByText(/^About/)).toBeNull();
  });
});
