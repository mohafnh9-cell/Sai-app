import { globalPluginRegistry } from "../../core/declarative/plugin/plugin-registry";
import { CANONICAL_PIPELINE_STAGE_ORDER } from "../../core/declarative/canonical-stages";
import { RT10_LLM_MANIFEST, RT10_ROOT_CAPABILITY_ID } from "./manifest";
import { createRt10StageHandlers } from "./stage-handlers";

const PLUGIN_ID = "rt10.llm.plugin";

if (!globalPluginRegistry.get(PLUGIN_ID)) {
  globalPluginRegistry.register({
    pluginId: PLUGIN_ID,
    manifest: RT10_LLM_MANIFEST,
    handlers: createRt10StageHandlers(),
    supportedStageIds: [...CANONICAL_PIPELINE_STAGE_ORDER],
    rootCapabilityId: RT10_ROOT_CAPABILITY_ID,
    metadata: { autoRegistered: true },
  });
}
