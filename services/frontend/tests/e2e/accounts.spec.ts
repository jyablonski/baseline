import { expect, test, type Page } from "@playwright/test";

import { E2E, STUB_API_URL } from "./e2e-env";
import { primaryNav } from "./helpers";
import {
  accountNav,
  blockUser,
  githubOwner,
  googleOwner,
  resetStub,
  signInAs,
  stubRequests,
  visitor,
} from "./session";

/**
 * Accounts, picks, chat and feature flags, end to end.
 *
 * No window.fetch mocking here. The browser talks to the stub API directly for
 * public data, and every signed-in action goes browser -> server action ->
 * session check -> stub API, the same path as production. Sessions are real
 * NextAuth cookies minted with the dev server's secret (see session.ts).
 *
 * Serial, in one worker: the stub's feature flags are shared state, and a spec
 * that switches the chatbot off must not do it underneath another one.
 */
test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await resetStub();
});

const GSW_LAL = "00000000-0000-4000-8000-000000000401";

function row(page: Page, arena: string) {
  return page.getByRole("row").filter({ hasText: arena });
}

// --- signing in ---------------------------------------------------------------

test.describe("sign-in", () => {
  test("an anonymous visitor is offered sign-in, returning to the page they were on", async ({
    page,
  }) => {
    await page.goto("/schedule");
    const signIn = accountNav(page).getByRole("link", { name: "Sign in" });
    await expect(signIn).toHaveAttribute("href", "/signin?callbackUrl=%2Fschedule");
    await signIn.click();
    await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByText("Sign in to make picks.")).toBeVisible();
    // The signed-in features are not advertised in the main navigation.
    await expect(primaryNav(page).getByRole("link", { name: /picks/i })).toHaveCount(0);
  });

  test("a failed sign-in explains itself on the public page", async ({ page }) => {
    await page.goto("/signin?error=OAuthAccountNotLinked");
    await expect(page.getByText(/already tied to a different sign-in method/)).toBeVisible();
    await page.goto("/signin?error=SomethingNew");
    await expect(page.getByText("Sign-in failed. Try again.")).toBeVisible();
  });

  test("a signed-in visitor gets a profile menu instead", async ({ page, context }) => {
    await signInAs(context, visitor({ name: "Pat Tester" }));
    await page.goto("/");
    const nav = accountNav(page);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await nav.getByRole("button", { name: /Pat Tester/ }).click();
    const menu = page.getByRole("menu", { name: "Your account" });
    await expect(menu.getByRole("menuitem", { name: "Account" })).toHaveAttribute(
      "href",
      "/account"
    );
    await menu.getByRole("menuitem", { name: "Your picks" }).click();
    await expect(page).toHaveURL(/\/picks$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  });

  test("the session a browser can read carries no provider account id", async ({
    page,
    context,
  }) => {
    await signInAs(context, visitor());
    const session = await (await page.request.get("/api/auth/session")).json();
    expect(session.user.provider).toBe("google");
    expect(typeof session.user.userId).toBe("string");
    expect(JSON.stringify(session)).not.toContain("subject");
  });

  test("an account is registered on first use when sign-in could not do it", async ({
    page,
    context,
  }) => {
    // No user id in the token: the API was unreachable when they signed in.
    await signInAs(context, visitor({ userId: null }));
    await page.goto("/picks");
    await expect(page.getByText("No picks yet").first()).toBeVisible();
    const registration = (await stubRequests()).find((request) => request.path === "/users");
    expect(registration?.body).toMatchObject({ provider: "google", display_name: "Pat Tester" });
    // Identified by the provider's account id. No email leaves the frontend.
    expect(JSON.stringify(registration?.body)).not.toContain("visitor@e2e.test");
  });
});

// --- the admin gate -----------------------------------------------------------

test.describe("admin access", () => {
  test("the owner gets in with GitHub", async ({ page, context }) => {
    await signInAs(context, githubOwner);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();
    await expect(page.getByText("System status")).toBeVisible();
  });

  test("the owner gets in with Google", async ({ page, context }) => {
    await signInAs(context, googleOwner);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText("System status")).toBeVisible();
  });

  const strangers = [
    ["a Google user", visitor()],
    ["a GitHub user", { provider: "github", login: "someone-else" }],
    [
      "the owner's address on an unverified Google account",
      { provider: "google", email: E2E.ownerEmail, verifiedEmail: false },
    ],
    [
      "the owner's address on a GitHub profile",
      { provider: "github", login: "someone-else", email: E2E.ownerEmail, verifiedEmail: true },
    ],
    [
      "the owner's GitHub login claimed through Google",
      { provider: "google", login: E2E.ownerLogin, email: "x@e2e.test", verifiedEmail: true },
    ],
  ] as const;

  for (const [who, identity] of strangers) {
    test(`${who} is turned away from every admin route`, async ({ page, context }) => {
      await signInAs(context, identity);
      for (const path of ["/admin", "/admin/jobs", "/admin/signin-backdoor"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/admin\/signin\?error=AccessDenied$/);
        await expect(page.getByText("That account is not on the admin allowlist.")).toBeVisible();
        await expect(page.getByText("System status")).toHaveCount(0);
        await expect(page.getByText("Feature flags")).toHaveCount(0);
      }
      // Still a perfectly good account everywhere else.
      await page.goto("/picks");
      await expect(page.getByText("No picks yet").first()).toBeVisible();
    });
  }

  test("a signed-in visitor is not shown a way into admin", async ({ page, context }) => {
    await signInAs(context, visitor());
    await page.goto("/");
    await expect(page.getByRole("link", { name: /admin/i })).toHaveCount(0);
    await page.goto("/account");
    await expect(page.getByText("Signed in as")).toBeVisible();
    await expect(page.getByRole("link", { name: /admin/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Admin" })).toHaveCount(0);
  });

  test("the owner's account page links to admin", async ({ page, context }) => {
    await signInAs(context, googleOwner);
    await page.goto("/account");
    await page.getByRole("link", { name: "Open admin →" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText("System status")).toBeVisible();
  });
});

// --- picks --------------------------------------------------------------------

test.describe("picks", () => {
  test("an anonymous visitor sees the pick buttons and is sent to sign in", async ({ page }) => {
    await page.goto("/schedule");
    await expect(row(page, "Chase Center")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Your pick" })).toBeVisible();
    // The steps are a popup, not a banner above the table.
    await expect(page.getByText("Pick a winner")).toHaveCount(0);
    await row(page, "Chase Center").getByRole("button", { name: "Pick GSW" }).click();
    const steps = page.getByRole("dialog", { name: "How picks work" });
    await expect(steps).toContainText("Add a stake, if you want");
    await steps.getByRole("link", { name: "Sign in to start" }).click();
    await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fschedule/);

    await page.goto("/picks");
    await expect(page.getByText("Sign in to pick winners")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin?callbackUrl=%2Fpicks"
    );
    expect((await stubRequests()).filter((request) => request.path.startsWith("/picks"))).toEqual(
      []
    );
  });

  test("pick a winner, add a stake, switch sides, and clear it", async ({ page, context }) => {
    const userId = await signInAs(context, visitor());
    await page.goto("/schedule");
    const game = row(page, "Chase Center");
    await page.getByRole("button", { name: "How picks work" }).click();
    await expect(page.getByRole("dialog", { name: "How picks work" })).toContainText(
      "Track your net"
    );
    await page.keyboard.press("Escape");
    // Nobody is handed a balance to bet with.
    await expect(page.getByText(/balance|available/i)).toHaveCount(0);

    // One click is a pick. The stake is a separate, optional step.
    await game.getByRole("button", { name: "Pick GSW" }).click();
    await expect(game.getByRole("button", { name: "Pick GSW" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("stake-editor")).toHaveCount(0);

    await game.getByRole("button", { name: "Add stake" }).click();
    const editor = page.getByTestId("stake-editor");
    await expect(page.getByRole("dialog", { name: "GSW to win" })).toContainText("−150");
    await expect(editor.getByText("Counts toward your record only")).toBeVisible();
    await editor.getByRole("button", { name: "$50" }).click();
    await expect(editor.getByText("Returns $83.33 if GSW win · net +$33.33")).toBeVisible();
    await editor.getByRole("button", { name: "Save stake" }).click();
    await expect(page.getByTestId("stake-editor")).toHaveCount(0);
    await expect(game.getByText("$50 to win $33.33")).toBeVisible();

    // The other side is priced differently, and the stake follows the pick.
    await game.getByRole("button", { name: "Pick LAL" }).click();
    await expect(game.getByText("$50 to win $65")).toBeVisible();

    // A custom amount, with no balance to check it against.
    await game.getByRole("button", { name: "Edit stake" }).click();
    await page.getByLabel("Other stake").fill("1001");
    await expect(page.getByText("Whole dollars, from $1 to $1,000.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save stake" })).toBeDisabled();
    await page.getByLabel("Other stake").fill("1000");
    await page.getByRole("button", { name: "Save stake" }).click();
    await expect(game.getByText("$1,000 to win $1,300")).toBeVisible();

    // It is there after a reload, and on the picks page.
    await page.reload();
    await expect(row(page, "Chase Center").getByText("$1,000 to win $1,300")).toBeVisible();
    await page.getByRole("link", { name: "Your picks" }).click();
    await expect(page).toHaveURL(/\/picks$/);
    await expect(page.getByRole("heading", { name: "Pat Tester", level: 1 })).toBeVisible();
    const open = page.getByTestId("open-pick");
    await expect(open).toHaveCount(1);
    await expect(open).toContainText("LAL +130 at GSW");
    await expect(open).toContainText("7:30 PM ET");
    await expect(open).toContainText("to win $1,300");
    await expect(page.getByText("$1,000 riding on open picks")).toBeVisible();
    await expect(page.getByText(/balance|started at/i)).toHaveCount(0);

    await page.goto("/schedule");
    await row(page, "Chase Center")
      .getByRole("button", { name: /Clear pick/ })
      .click();
    await expect(row(page, "Chase Center").getByRole("button", { name: /Clear pick/ })).toHaveCount(
      0
    );

    // Every call the server made was as this user, taken from the session.
    const calls = (await stubRequests()).filter((request) => request.path.startsWith("/picks"));
    expect(calls.length).toBeGreaterThan(4);
    expect(new Set(calls.map((request) => request.user))).toEqual(new Set([userId]));
    const puts = calls.filter((request) => request.method === "PUT");
    expect(puts[0].path).toBe(`/picks/${GSW_LAL}`);
    expect(puts.map((request) => (request.body as { stake: number | null }).stake)).toEqual([
      null,
      50,
      50,
      1000,
    ]);
  });

  test("a game with no moneyline takes a pick but offers no stake", async ({ page, context }) => {
    await signInAs(context, visitor());
    await page.goto("/schedule");
    const game = row(page, "Kaseya Center");
    await game.getByRole("button", { name: "Pick MIA" }).click();
    await expect(game.getByRole("button", { name: "Pick MIA" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(game.getByRole("button", { name: /Clear pick/ })).toBeVisible();
    await expect(game.getByRole("button", { name: /stake/i })).toHaveCount(0);
    await page.goto("/picks");
    // No price on file, so the label is just the matchup.
    await expect(page.getByTestId("open-pick")).toContainText("MIA vs MIL");
    await expect(page.getByTestId("open-pick")).toContainText("record only");
  });

  test("a session whose account is gone repairs itself instead of hiding picks", async ({
    page,
    context,
  }) => {
    // The cookie names an account id the API has no row for, as after the
    // account was deleted elsewhere. The first call 404s; the page must not
    // just lose its pick column.
    const staleId = await signInAs(context, visitor({ stale: true }));
    await page.goto("/schedule");
    const game = row(page, "Chase Center");
    await game.getByRole("button", { name: "Pick GSW" }).click();
    await expect(game.getByRole("button", { name: /Clear pick/ })).toBeVisible();

    const requests = await stubRequests();
    // Registered again as the same identity, then carried on under the new id.
    expect(requests.some((request) => request.path === "/users")).toBe(true);
    const saved = requests.find((request) => request.method === "PUT");
    expect(saved?.user).toBeTruthy();
    expect(saved?.user).not.toBe(staleId);

    // The repaired id is in the cookie now: a reload needs no second repair.
    const registrations = () =>
      stubRequests().then((all) => all.filter((request) => request.path === "/users").length);
    const before = await registrations();
    await page.reload();
    await expect(
      row(page, "Chase Center").getByRole("button", { name: /Clear pick/ })
    ).toBeVisible();
    expect(await registrations()).toBe(before);
  });

  test("two visitors keep separate picks", async ({ browser }) => {
    const mine = await browser.newContext();
    const theirs = await browser.newContext();
    await signInAs(mine, visitor({ name: "Mine" }));
    await signInAs(theirs, visitor({ name: "Theirs" }));

    const myPage = await mine.newPage();
    await myPage.goto("/schedule");
    await row(myPage, "Chase Center").getByRole("button", { name: "Pick GSW" }).click();
    await expect(
      row(myPage, "Chase Center").getByRole("button", { name: /Clear pick/ })
    ).toBeVisible();

    const theirPage = await theirs.newPage();
    await theirPage.goto("/picks");
    await expect(theirPage.getByText("No picks yet").first()).toBeVisible();
    await theirPage.goto("/schedule");
    await expect(
      row(theirPage, "Chase Center").getByRole("button", { name: "Pick GSW" })
    ).toHaveAttribute("aria-pressed", "false");
    await mine.close();
    await theirs.close();
  });

  test("a blocked account is told so, and can do nothing", async ({ page, context }) => {
    const userId = await signInAs(context, visitor());
    await blockUser(userId as string);
    await page.goto("/picks");
    await expect(page.getByText("This account has been blocked.")).toBeVisible();
    await page.goto("/schedule");
    await expect(row(page, "Chase Center")).toBeVisible();
    await expect(page.getByTestId("pick-cell")).toHaveCount(0);
  });
});

// --- chat ---------------------------------------------------------------------

test.describe("chat", () => {
  test("an anonymous visitor is asked to sign in, and Ask still works without one", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByText("Sign in to ask questions about the data.")).toBeVisible();
    // Chat is available here, so it takes Ask's place in the tabs. One or the other.
    await expect(primaryNav(page).getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(primaryNav(page).getByRole("link", { name: "Ask" })).toHaveCount(0);
    await expect(page.getByLabel("Your question")).toHaveCount(0);

    await page.goto("/ask");
    await page.getByPlaceholder("Ask a bounded question").fill("Who leads the West?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Rules answer.")).toBeVisible();
    expect((await stubRequests()).filter((request) => request.path === "/chat")).toEqual([]);
  });

  test("a conversation: answers show their rows, follow-ups carry context, the quota counts down", async ({
    page,
    context,
  }) => {
    const userId = await signInAs(context, visitor());
    await page.goto("/chat");
    await expect(page.getByTestId("chat-quota")).toContainText("3 of 3 left");
    await expect(page.getByText("may be sent to a third-party model provider")).toBeVisible();

    const field = page.getByLabel("Your question");
    await expect(page.getByRole("button", { name: "What is Curry's salary?" })).toBeVisible();
    await field.fill("Who leads the West?");
    await field.press("Enter");
    const first = page.getByTestId("chat-exchange").nth(0);
    await expect(first.getByText("Answer 1: Who leads the West?")).toBeVisible();
    // The rows behind the answer, and where they came from.
    await expect(first.getByRole("cell", { name: "OKC" })).toBeVisible();
    await expect(first.getByText("Source: standings · 1 of 1 row")).toBeVisible();
    await expect(page.getByTestId("chat-quota")).toContainText("2 of 3");
    await expect(page.getByTestId("chat-turns")).toContainText("Question 2 of 3");
    await expect(field).toHaveAttribute("placeholder", "Ask a follow-up");

    // A suggested follow-up for a standings answer is asked with one click.
    await expect(page.getByRole("button", { name: "What is Curry's salary?" })).toHaveCount(0);
    await page.getByRole("button", { name: "And the other conference?" }).click();
    await expect(
      page.getByTestId("chat-exchange").nth(1).getByText("Answer 2: And the other conference?")
    ).toBeVisible();
    await expect(page.getByTestId("chat-quota")).toContainText("1 of 3");

    const chats = (await stubRequests()).filter((request) => request.path === "/chat");
    expect(chats).toHaveLength(2);
    expect(chats.every((request) => request.user === userId)).toBe(true);
    expect(chats[1].body).toMatchObject({
      messages: [
        { role: "user", content: "Who leads the West?" },
        { role: "assistant", content: "Answer 1: Who leads the West?" },
        { role: "user", content: "And the other conference?" },
      ],
    });

    // A new conversation drops the context but not the day's count.
    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(page.getByTestId("chat-exchange")).toHaveCount(0);
    await field.fill("Fresh question");
    await field.press("Enter");
    await expect(page.getByText("Answer 1: Fresh question")).toBeVisible();
    await expect(page.getByTestId("chat-quota")).toContainText("0 of 3");

    // Out of questions: the field closes, and it stays closed after a reload.
    await expect(page.getByPlaceholder("No questions left today")).toBeDisabled();
    await page.reload();
    await expect(page.getByPlaceholder("No questions left today")).toBeDisabled();
    expect((await stubRequests()).filter((request) => request.path === "/chat")).toHaveLength(3);
  });

  test("one visitor's questions do not count against another", async ({ browser }) => {
    const first = await browser.newContext();
    await signInAs(first, visitor());
    const firstPage = await first.newPage();
    await firstPage.goto("/chat");
    await firstPage.getByLabel("Your question").fill("One");
    await firstPage.getByLabel("Your question").press("Enter");
    await expect(firstPage.getByTestId("chat-quota")).toContainText("2 of 3");

    const second = await browser.newContext();
    await signInAs(second, visitor());
    const secondPage = await second.newPage();
    await secondPage.goto("/chat");
    await expect(secondPage.getByTestId("chat-quota")).toContainText("3 of 3");
    await first.close();
    await second.close();
  });
});

// --- feature flags ------------------------------------------------------------

test.describe("feature flags", () => {
  test("the owner switches the chatbot off in admin, and it is gone for everyone", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    await signInAs(ownerContext, githubOwner);
    const admin = await ownerContext.newPage();

    const userContext = await browser.newContext();
    await signInAs(userContext, visitor());
    const user = await userContext.newPage();

    // On to begin with.
    await user.goto("/chat");
    await expect(user.getByLabel("Your question")).toBeEnabled();

    await admin.goto("/admin");
    const chatbot = admin.getByTestId("flag-chatbot");
    await expect(chatbot.getByText("On", { exact: true })).toBeVisible();
    await expect(chatbot.getByText("Never changed")).toBeVisible();
    await chatbot.getByRole("button", { name: "Turn off" }).click();
    await expect(chatbot.getByText("Off", { exact: true })).toBeVisible();
    await expect(chatbot.getByRole("button", { name: "Turn on" })).toBeVisible();
    await expect(chatbot.getByText(`by ${E2E.ownerLogin}`)).toBeVisible();
    await expect(admin.getByText("chatbot is now off.")).toBeVisible();
    // The other flag is untouched.
    await expect(admin.getByTestId("flag-picks").getByText("On", { exact: true })).toBeVisible();

    // The page the visitor already has open still shows the field, but the
    // server refuses the question: the flag is enforced, not just hidden.
    await user.getByLabel("Your question").fill("Still there?");
    await user.getByLabel("Your question").press("Enter");
    await expect(user.getByText("Chat is turned off right now.")).toBeVisible();

    // On the next load it is gone, with a pointer to the free Ask page.
    await user.reload();
    await expect(user.getByText("Chat is not available")).toBeVisible();
    await expect(user.getByLabel("Your question")).toHaveCount(0);
    // The tab flips back to Ask: one or the other, never both.
    await expect(primaryNav(user).getByRole("link", { name: "Chat" })).toHaveCount(0);
    await expect(primaryNav(user).getByRole("link", { name: "Ask" })).toBeVisible();
    await user.getByRole("link", { name: /Ask a single question/ }).click();
    await expect(user).toHaveURL(/\/ask$/);
    await user.getByPlaceholder("Ask a bounded question").fill("Who leads the West?");
    await user.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(user.getByText("Rules answer.")).toBeVisible();

    // And back on.
    await chatbot.getByRole("button", { name: "Turn on" }).click();
    await expect(chatbot.getByText("On", { exact: true })).toBeVisible();
    await user.goto("/chat");
    await expect(user.getByLabel("Your question")).toBeEnabled();

    await ownerContext.close();
    await userContext.close();
  });

  test("switching picks off removes them from the schedule and the picks page", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    await signInAs(ownerContext, googleOwner);
    const admin = await ownerContext.newPage();
    await admin.goto("/admin");
    await admin.getByTestId("flag-picks").getByRole("button", { name: "Turn off" }).click();
    await expect(admin.getByTestId("flag-picks").getByText(`by ${E2E.ownerEmail}`)).toBeVisible();

    const userContext = await browser.newContext();
    await signInAs(userContext, visitor());
    const user = await userContext.newPage();
    await user.goto("/schedule");
    await expect(row(user, "Chase Center")).toBeVisible();
    await expect(user.getByTestId("pick-cell")).toHaveCount(0);
    await user.goto("/picks");
    await expect(user.getByText("Picks are paused")).toBeVisible();
    await accountNav(user)
      .getByRole("button", { name: /Pat Tester/ })
      .click();
    await expect(user.getByRole("menuitem", { name: "Your picks" })).toHaveCount(0);
    await expect(user.getByRole("menuitem", { name: "Account" })).toBeVisible();
    // Chat is a separate switch.
    await expect(primaryNav(user).getByRole("link", { name: "Chat" })).toBeVisible();

    await ownerContext.close();
    await userContext.close();
  });

  test("a signed-in visitor cannot flip a flag by calling the admin API", async ({
    page,
    context,
  }) => {
    await signInAs(context, visitor());
    await page.goto("/");
    // Their session is worth nothing to the API, and they hold no admin token.
    const direct = await page.request.put(`${STUB_API_URL}/api/v1/admin/flags/chatbot`, {
      data: { enabled: false, updated_by: "visitor" },
    });
    expect(direct.status()).toBe(401);
    const features = await (await page.request.get(`${STUB_API_URL}/api/v1/features`)).json();
    expect(features.data.chatbot).toBe(true);
  });
});

// --- the account page ---------------------------------------------------------

test.describe("account", () => {
  test("an anonymous visitor is told they are not signed in", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByText("You are not signed in.")).toBeVisible();
  });

  test("signing out from the profile menu ends the session", async ({ page, context }) => {
    await signInAs(context, visitor());
    await page.goto("/schedule");
    await accountNav(page)
      .getByRole("button", { name: /Pat Tester/ })
      .click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/picks");
    await expect(page.getByText("Sign in to pick winners")).toBeVisible();
  });

  test("a chosen time zone shifts game times and is remembered", async ({ page, context }) => {
    await signInAs(context, visitor());
    await page.goto("/schedule");
    await expect(row(page, "Chase Center")).toContainText("7:30 PM ET");

    await page.goto("/account");
    await page.getByLabel("Time zone").selectOption({ label: "Pacific (Los Angeles)" });
    await expect(page.getByLabel("Time zone")).toHaveValue("America/Los_Angeles");
    await page.goto("/schedule");
    await expect(row(page, "Chase Center")).toContainText(/4:30 PM P[DS]T/);
    await page.goto("/account");
    await expect(page.getByTestId("member-since")).toHaveText("Member since October 3, 2026");
    await expect(page.getByLabel("Time zone")).toHaveValue("America/Los_Angeles");
  });

  test("signing out from the account page ends the session", async ({ page, context }) => {
    await signInAs(context, visitor({ name: "Pat Tester" }));
    await page.goto("/account");
    await expect(page.getByText("Signed in as")).toContainText("Pat Tester");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/picks");
    await expect(page.getByText("Sign in to pick winners")).toBeVisible();
  });

  test("deleting the account asks twice, removes it, and signs out", async ({ page, context }) => {
    const userId = await signInAs(context, visitor());
    await page.goto("/schedule");
    await row(page, "Chase Center").getByRole("button", { name: "Pick GSW" }).click();
    await expect(
      row(page, "Chase Center").getByRole("button", { name: /Clear pick/ })
    ).toBeVisible();

    await page.goto("/account");
    await expect(page.getByText(/Your email address is not stored/)).toBeVisible();
    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await stubRequests()).some((request) => request.method === "DELETE")).toBe(false);

    await page.getByRole("button", { name: "Delete my account" }).click();
    await page.getByRole("button", { name: "Yes, delete everything" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeVisible();

    const deletion = (await stubRequests()).find(
      (request) => request.method === "DELETE" && request.path === "/me"
    );
    expect(deletion?.user).toBe(userId);
  });
});
