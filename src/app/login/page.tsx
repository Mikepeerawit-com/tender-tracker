import { getTranslations } from "next-intl/server";

import { AuthScreen } from "@/components/auth/auth-screen";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations("login");
  const { error } = await searchParams;

  return (
    <AuthScreen title={t("title")} description={t("description")}>
      <LoginForm linkError={error === "link"} />
    </AuthScreen>
  );
}
