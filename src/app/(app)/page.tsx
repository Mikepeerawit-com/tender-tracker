import { redirect } from "next/navigation";

/**
 * The Tender list is the app's home. It lives at `/tenders` rather than here so that a
 * reminder link posted into WeCom months ago still points somewhere that means the same
 * thing, and `/` stays a doorway rather than a second copy of the list.
 */
export default function Home() {
  redirect("/tenders");
}
