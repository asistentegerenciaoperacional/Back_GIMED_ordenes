import { createApp } from "../_shared/http.ts";
import { configFrom } from "../_shared/config.ts";
import { connect } from "../_shared/postgres.ts";

const config = configFrom((key) => Deno.env.get(key));
const app = createApp(config, connect(config.databaseUrl));
Deno.serve(app.fetch);
