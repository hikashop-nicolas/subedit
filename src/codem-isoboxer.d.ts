// Minimal typings for codem-isoboxer (ships no .d.ts). We only use the parse tree: boxes
// with a type, byte position (_offset/size), children (.boxes) and the parsed fields we
// read (handler_type, timescale, language, stts entries, stsd entries).
declare module "codem-isoboxer" {
  export interface ISOBox {
    type: string;
    size: number;
    _offset: number;
    boxes?: ISOBox[];
    // parsed fields we read (present only on the relevant box types)
    handler_type?: string;
    timescale?: number;
    language?: number | string;
    entry_count?: number;
    entries?: { type?: string; sample_count?: number; sample_delta?: number }[];
  }
  export interface ISOFile extends ISOBox {
    fetchAll(type: string): ISOBox[];
    fetch(type: string): ISOBox | null;
  }
  const ISOBoxer: {
    parseBuffer(buffer: ArrayBuffer): ISOFile;
  };
  export default ISOBoxer;
}
