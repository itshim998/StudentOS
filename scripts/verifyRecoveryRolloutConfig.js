import { validateRecoveryRolloutEnvironment } from "../backend/recovery/recoveryConfig.js";

const result = validateRecoveryRolloutEnvironment(process.env);
const safeResult = {
  ok: result.ok,
  mode: result.mode,
  userCount: result.userCount,
  errors: result.errors,
  secretsPrinted: false,
};

console.log(JSON.stringify(safeResult, null, 2));
if (!result.ok) process.exit(1);
