/** No hidden retries: every transport failure remains an explicit gate failure. */
export async function demoFetch(url, options, transport = globalThis.fetch) {
  try {
    return await transport(url, options);
  } catch (error) {
    const code = String(error?.cause?.code ?? error?.name ?? 'unknown');
    throw new Error(`Demo HTTP ${options?.method ?? 'GET'} ${new URL(url).pathname} failed (${code}).`, { cause: error });
  }
}
