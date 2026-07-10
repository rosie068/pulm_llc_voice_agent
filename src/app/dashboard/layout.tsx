import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";

const NAV = [
  { href: "/dashboard/calls", label: "Calls" },
  { href: "/dashboard/flags", label: "Flags" },
  { href: "/dashboard/queues", label: "Outbound Queues" },
  { href: "/dashboard/appointments", label: "Appointments" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-brand p-4 text-white">
        <Link href="/dashboard" className="mb-6 block text-lg font-semibold">
          Pulm Voice Agent
        </Link>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-2 text-sm text-white/85 hover:bg-brand-dark hover:text-white"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8">
          <UserButton />
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
