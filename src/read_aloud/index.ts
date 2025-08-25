import { driverStore } from "../store";
import { readSequentially as nativeReadSequentially } from "./native_read_aloud";
import { readSequentially as simpleServerReadSequentially } from "./simple_server_read_aloud";
import { ReadAloudDriver } from "../types.d";

export async function readAloud(texts: string[]) {
  const driver = await driverStore.get();

  switch (driver) {
    case ReadAloudDriver.SimpleServer:
      return await simpleServerReadSequentially(texts);
    case ReadAloudDriver.Native:
      return await nativeReadSequentially(texts);
  }
}

export async function previewReadAloud() {
  await readAloud(["The quick brown fox jumps over the lazy dog"]);
}
