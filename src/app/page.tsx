import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton, UserButton } from "@clerk/nextjs";

export default async function Home() {
  const { userId } = await auth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-brand">The Pulmonology Group2 — Voice Agent</h1>
      {userId ? (
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="rounded-md bg-coral px-4 py-2 font-medium text-brand-dark hover:bg-coral-light active:bg-coral-active">
            Open dashboard
          </Link>
          <UserButton />
        </div>
      ) : (
        <SignInButton mode="modal">
          <button className="rounded-md bg-coral px-4 py-2 font-medium text-brand-dark hover:bg-coral-light active:bg-coral-active">
            Staff sign in
          </button>
        </SignInButton>
      )}
    </main>
  );
}
