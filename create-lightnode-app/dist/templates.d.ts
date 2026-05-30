/**
 * Template strings written into the scaffolded project. Kept as plain literals
 * (no string interpolation off external sources) so the generated files are
 * easy to diff against the examples/ directory in the lightnode repo.
 */
export interface ProjectConfig {
    projectName: string;
    template: "node" | "nextjs-api" | "hono";
    network: "testnet" | "mainnet";
}
export interface GeneratedFile {
    path: string;
    contents: string;
}
export declare function filesFor(cfg: ProjectConfig): GeneratedFile[];
export declare function addFilesFor(template: ProjectConfig["template"], network: ProjectConfig["network"]): GeneratedFile[];
