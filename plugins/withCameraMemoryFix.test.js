const { patchCameraSource, patchCameraLifecycle } = require('./withCameraMemoryFix');
const original = `fun Array<ImageProxy.PlaneProxy>.toByteArray() = this.fold(mutableListOf<Byte>()) { acc, plane ->
  acc.addAll(plane.buffer.toByteArray().toList())
  acc
}.toByteArray()`;
test('patches the known SDK routine and is idempotent', () => {
  const patched = patchCameraSource(original);
  expect(patched).toContain('buffer.get(data, offset, length)');
  expect(patched).not.toContain('mutableListOf<Byte>');
  expect(patchCameraSource(patched)).toBe(patched);
});
test('fails visibly if an SDK upgrade changes the routine', () => {
  expect(() => patchCameraSource('different SDK source')).toThrow('plane conversion changed');
});
test('camera release cannot unbind another screen and removes its LiveData observer', () => {
  const source = `camera = cameraProvider.bindToLifecycle(currentActivity, cameraSelector, useCases)
  private fun observeCameraState(cameraInfo: CameraInfo) {
    cameraInfo.cameraState.observe(currentActivity) { }
  }
  @OptIn(ExperimentalCamera2Interop::class)
  fun releaseCamera() = appContext.mainQueue.launch {
    shouldCreateCamera = true
    cameraProvider?.unbindAll()
  }`;
  const patched = patchCameraLifecycle(source);
  expect(patched).toContain('cameraProvider?.unbind(*ownedUseCases.toTypedArray())');
  expect(patched).toContain('cameraState?.removeObserver(it)');
  expect(patched).not.toContain('cameraProvider?.unbindAll()');
  expect(patchCameraLifecycle(patched)).toBe(patched);
});
test('lifecycle patch refuses an unfamiliar SDK', () => {
  expect(() => patchCameraLifecycle('unknown')).toThrow('lifecycle changed');
});
