const _key2val = new Map<string, string>();

export async function cacheGet(key: string) {
  if (!_key2val.has(key)) {
    console.log("not finding key", key, _key2val);
    return undefined;
  }
  console.log(`found key ${key} in cache. Value : ${_key2val.get(key)}`);
  return _key2val.get(key);
}

export async function cacheSet(key: string, value: string) {
  _key2val.set(key, value);
}
