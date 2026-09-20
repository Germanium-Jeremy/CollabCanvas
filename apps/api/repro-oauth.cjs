const { PrismaClient } = require("@prisma/client");
const c = new PrismaClient();

async function main() {
  // 1) Read-only DB state (emails masked)
  const users = await c.user.findMany({ select: { id: true, email: true } });
  const accounts = await c.account.findMany({ select: { provider: true } });
  const byProvider = {};
  for (const a of accounts) byProvider[a.provider] = (byProvider[a.provider] ?? 0) + 1;
  console.log("users:", users.length, users.map((u) => u.email.split("@")[0].slice(0, 3) + "***"));
  console.log("accounts by provider:", JSON.stringify(byProvider));

  // 2) Reproduce findOrCreateOAuthUser's upsert for a synthetic Google profile,
  //    rolled back so no data is written.
  const profile = {
    provider: "google",
    providerAccountId: "repro-sub-1234567890",
    email: "repro-oauth-debug@example.com",
    name: "Repro Debug",
    image: "https://lh3.googleusercontent.com/repro",
  };
  try {
    await c.$transaction(async (tx) => {
      const created = await tx.user.upsert({
        where: { email: profile.email },
        create: {
          email: profile.email,
          name: profile.name,
          image: profile.image,
          accounts: { create: { provider: profile.provider, providerAccountId: profile.providerAccountId } },
        },
        update: {
          accounts: { create: { provider: profile.provider, providerAccountId: profile.providerAccountId } },
        },
        include: { accounts: true },
      });
      console.log("REPRO UPSERT OK -> userId:", created.id, "accounts:", created.accounts.map((a) => a.provider));
      throw new Error("__rollback__");
    });
  } catch (e) {
    if (e && e.message === "__rollback__") {
      console.log("transaction rolled back cleanly (no data written)");
    } else {
      console.error("REPRO UPSERT FAILED:", e.code ?? "", e.message);
    }
  }
}

main()
  .then(() => c.$disconnect())
  .catch((e) => {
    console.error("FATAL:", e.code ?? "", e.message);
    process.exit(1);
  });
