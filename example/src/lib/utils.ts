export function convertPcmFloat32To16BitPcm(
  float32Array: Float32Array
): DataView {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]!));
    view.setInt16(offset, s < 0 ? s * 0x80_00 : s * 0x7f_ff, true);
  }
  return view;
}
