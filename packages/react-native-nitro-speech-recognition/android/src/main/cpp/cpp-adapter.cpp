#include <jni.h>
#include "NitroSpeechRecognitionOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::nitrospeechrecognition::initialize(vm);
}
