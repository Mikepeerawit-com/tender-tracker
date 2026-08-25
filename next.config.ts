import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { migrationsOnDiskEnv } from "./src/lib/schema/migrations-on-disk.mts";

const nextConfig: NextConfig = {
  env: {
    // Read from `supabase/migrations/` here, at build time, because `supabase/` is not
    // part of a deployed bundle and `/api/health` has to know what this build expects in
    // order to notice a database that is behind it. See src/lib/schema/.
    EXPECTED_SCHEMA_MIGRATIONS: migrationsOnDiskEnv(),
  },
};

export default createNextIntlPlugin()(nextConfig);
