import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50">
        Page not found
      </h1>
      <p className="text-stone-600 dark:text-stone-400">
        That docs page does not exist.
      </p>
      <Link
        href="/"
        className="rounded-ui bg-brandPrimary px-4 py-2 text-sm font-medium text-white"
      >
        Back to docs home
      </Link>
    </main>
  );
}
