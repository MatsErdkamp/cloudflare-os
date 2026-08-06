import { Field, h, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  R2RootConfiguratorRpc,
  R2RootConfiguratorValues,
} from "./root-configurator-types";

export default {
  initial: {},
  isReady() { return true; },
  resourceUrl({ ui }) { return ui.resourceUrl(); },
  render() {
    return <Section>
      <Field
        label="Private storage root"
        description="Connect this account's isolated R2 object namespace as a private Source."
      />
    </Section>;
  },
} satisfies ConfiguratorUISpec<R2RootConfiguratorRpc, R2RootConfiguratorValues>;
