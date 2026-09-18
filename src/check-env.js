import { missingEnv } from "./config.js";
import { fail, ok, banner } from "./logger.js";

banner("Vérification des secrets");
const absent = missingEnv();
if (absent.length) {
  fail(`Manquants : ${absent.join(", ")}`);
  process.exit(1);
}
ok("Secrets OK (MagicLight, Google, Gemini).");
