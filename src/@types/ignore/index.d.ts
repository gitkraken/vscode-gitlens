declare module "ignore" {
    namespace ignore {
        interface Ignore {
            add(patterns: string | Array<string> | Ignore): Ignore;
            filter(paths: Array<string>): Array<string>;
        }
    }
    function ignore(): ignore.Ignore;
    export = ignore;
}
