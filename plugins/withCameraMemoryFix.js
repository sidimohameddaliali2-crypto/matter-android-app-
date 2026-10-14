const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const marker = '// Delivery Driver: copy camera planes without boxing every JPEG byte.';
function patchCameraSource(source) {
  if (source.includes(marker)) return source;
  const original = /fun Array<ImageProxy\.PlaneProxy>\.toByteArray\(\) = this\.fold\(mutableListOf<Byte>\(\)\) \{ acc, plane ->\s*acc\.addAll\(plane\.buffer\.toByteArray\(\)\.toList\(\)\)\s*acc\s*\}\.toByteArray\(\)/;
  if (!original.test(source)) throw new Error('expo-camera plane conversion changed; review the camera memory patch before building.');
  return source.replace(original, `${marker}
fun Array<ImageProxy.PlaneProxy>.toByteArray(): ByteArray {
  val buffers = map { it.buffer.duplicate().apply { rewind() } }
  val data = ByteArray(buffers.sumOf { it.remaining() })
  var offset = 0
  for (buffer in buffers) {
    val length = buffer.remaining()
    buffer.get(data, offset, length)
    offset += length
  }
  return data
}`);
}

function applyCameraPatch(projectRoot) {
  const cameraRoot = path.dirname(require.resolve('expo-camera/package.json', { paths: [projectRoot] }));
  const file = path.join(cameraRoot, 'android/src/main/java/expo/modules/camera/analyzers/BarcodeAnalyzer.kt');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchCameraSource(source);
  if (patched !== source) fs.writeFileSync(file, patched);
  const viewFile = path.join(cameraRoot, 'android/src/main/java/expo/modules/camera/ExpoCameraView.kt');
  const viewSource = fs.readFileSync(viewFile, 'utf8');
  const viewPatched = patchCameraLifecycle(viewSource);
  if (viewPatched !== viewSource) fs.writeFileSync(viewFile, viewPatched);
}

function patchCameraLifecycle(source) {
  const lifecycleMarker = '// Delivery Driver: release only this view and detach its camera observer.';
  if (source.includes(lifecycleMarker)) return source;
  const observerStart = source.indexOf('  private fun observeCameraState(cameraInfo: CameraInfo) {');
  const observerEnd = source.indexOf('  @OptIn(ExperimentalCamera2Interop::class)', observerStart);
  const release = /  fun releaseCamera\(\) = appContext\.mainQueue\.launch \{\s*shouldCreateCamera = true\s*cameraProvider\?\.unbindAll\(\)\s*\}/;
  const bind = 'camera = cameraProvider.bindToLifecycle(currentActivity, cameraSelector, useCases)';
  if (observerStart < 0 || observerEnd < 0 || !release.test(source) || !source.includes(bind)) {
    throw new Error('expo-camera lifecycle changed; review the camera lifecycle patch before building.');
  }
  source = source.slice(0, observerStart) + `  ${lifecycleMarker}
  private var ownedUseCases = emptyList<androidx.camera.core.UseCase>()
  private var observedCameraInfo: CameraInfo? = null
  private var cameraStateObserver: androidx.lifecycle.Observer<CameraState>? = null

  private fun detachCameraObserver() {
    cameraStateObserver?.let { observedCameraInfo?.cameraState?.removeObserver(it) }
    cameraStateObserver = null
    observedCameraInfo = null
  }

  private fun observeCameraState(cameraInfo: CameraInfo) {
    detachCameraObserver()
    val observer = androidx.lifecycle.Observer<CameraState> {
      if (it.type == CameraState.Type.OPEN) {
        onCameraReady(Unit)
        setTorchEnabled(enableTorch)
      }
    }
    observedCameraInfo = cameraInfo
    cameraStateObserver = observer
    cameraInfo.cameraState.observe(currentActivity, observer)
  }

` + source.slice(observerEnd);
  source = source.replace(bind, `${bind}\n          ownedUseCases = useCases.useCases.toList()`);
  return source.replace(release, `  fun releaseCamera() = appContext.mainQueue.launch {
    shouldCreateCamera = true
    detachCameraObserver()
    cameraProvider?.unbind(*ownedUseCases.toTypedArray())
    ownedUseCases = emptyList()
    imageAnalysisUseCase?.clearAnalyzer()
    imageAnalysisUseCase = null
    imageCaptureUseCase = null
    camera = null
  }`);
}

module.exports = config => withDangerousMod(config, ['android', async config => {
  applyCameraPatch(config.modRequest.projectRoot);
  return config;
}]);
module.exports.patchCameraSource = patchCameraSource;
module.exports.applyCameraPatch = applyCameraPatch;
module.exports.patchCameraLifecycle = patchCameraLifecycle;
// Also cover checked-in/local Android builds that do not run Expo prebuild.
if (require.main === module) applyCameraPatch(path.resolve(__dirname, '..'));
