#!/bin/bash
# 手工打包 Yousj OTP 安卓客户端,不用 Gradle (aapt2 + kotlinc + d8 + zipalign + apksigner)
set -e
export JAVA_HOME=~/workspace/.jdk/jdk-17.0.20.1+1
export PATH="$JAVA_HOME/bin:$PATH"

SDK=~/workspace/android-sdk
BT=$SDK/build-tools/34.0.0
AJAR=$SDK/platforms/android-34/android.jar
KOTLINC=~/workspace/kotlinc/kotlinc
PROJ=~/workspace/yousj-otp/android
LIBS=$PROJ/libs
B=$PROJ/build/manual
rm -rf $B && mkdir -p $B/gen $B/classes $B/dex

CP="$AJAR:$LIBS/core-3.5.3.jar"

echo "[1/5] kotlinc..."
KOTLINC_OUT=$($KOTLINC/bin/kotlinc $(find $PROJ/app/src/main/java -name "*.kt") \
  -cp "$CP" -d $B/classes -jvm-target 17 2>&1 || true)
echo "$KOTLINC_OUT" | grep -v "^warning:" | head -20
if echo "$KOTLINC_OUT" | grep -q "error:"; then
  echo "KOTLINC FAILED"; exit 1
fi

echo "[2/5] d8 dex..."
$BT/d8 --lib "$AJAR" --min-api 26 --output $B/dex \
  $(find $B/classes -name "*.class") \
  $KOTLINC/lib/kotlin-stdlib.jar \
  $LIBS/core-3.5.3.jar

echo "[3/6] aapt2 compile res..."
$BT/aapt2 compile --dir $PROJ/app/src/main/res -o $B/res.zip

echo "[4/6] aapt2 link..."
$BT/aapt2 link -o $B/base.apk -I $AJAR \
  --manifest $PROJ/app/src/main/AndroidManifest.xml \
  --version-code 2 --version-name 1.0.1 \
  --java $B/gen $B/res.zip

echo "[5/6] add dex to apk..."
cd $B/dex && zip -q -j ../base.apk classes.dex && cd - > /dev/null

echo "[6/6] zipalign + sign..."
$BT/zipalign -f 4 $B/base.apk $B/aligned.apk
KS=~/.android/debug.keystore
if [ ! -f "$KS" ]; then
  mkdir -p ~/.android
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -keyalg RSA -keysize 2048 -validity 10950 -alias androiddebugkey \
    -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null
fi
$BT/apksigner sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out $PROJ/yousj-otp.apk $B/aligned.apk
$BT/apksigner verify --print-certs $PROJ/yousj-otp.apk | head -3
ls -la $PROJ/yousj-otp.apk
echo BUILD-DONE
