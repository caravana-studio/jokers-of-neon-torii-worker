import { createDojoConfig } from "@dojoengine/core";

// Por ahora, creamos un manifest básico
// TODO: Reemplazar con el manifest generado de tu proyecto Dojo
const manifest = {
  world: {
    name: "jokers_of_neon",
    // El world address se tomará de las variables de entorno
  },
  models: [],
  contracts: [],
};

export const dojoConfig = createDojoConfig({
  manifest,
});
