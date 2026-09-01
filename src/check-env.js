import { missingEnv } from "./config.js";
import { fail, ok, banner } from "./logger.js";

banner("Vérification des secrets");
const absent = missingEnv();
if (absent.length) {
  fail(`Manquants : ${absent.join(", ")}`);
  process.exit(1);
}
ok("MAGICLIGHT_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN sont définis.");
