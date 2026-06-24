// =============================================================================
// S3-PRO PTZ — MAITRE v3.4
// WebServer standard | Buffer circulaire UART | Zero latence PTZ
// PAN centre=1/2 | TILT centre=1/4
// =============================================================================
#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <HardwareSerial.h>
#include <Preferences.h>

// BROCHES CAMÉRA
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     15
#define SIOD_GPIO_NUM      4
#define SIOC_GPIO_NUM      5
#define Y9_GPIO_NUM       16
#define Y8_GPIO_NUM       17
#define Y7_GPIO_NUM       18
#define Y6_GPIO_NUM       12
#define Y5_GPIO_NUM       10
#define Y4_GPIO_NUM        8
#define Y3_GPIO_NUM        9
#define Y2_GPIO_NUM       11
#define VSYNC_GPIO_NUM     6
#define HREF_GPIO_NUM      7
#define PCLK_GPIO_NUM     13

// UART vers esclave
#define UART_SLAVE_RX     41
#define UART_SLAVE_TX     42
#define UART_BAUD         115200

// Paramètres capture HD
#define HD_FRAME_SIZE     FRAMESIZE_XGA
#define HD_QUALITY        4

HardwareSerial slaveSerial(1);
WebServer server(80);
Preferences preferences;
String ssid = "", password = "";

// FLUX VIDÉO
static camera_fb_t* latestFrame = nullptr;
static portMUX_TYPE frameMux = portMUX_INITIALIZER_UNLOCKED;
static SemaphoreHandle_t frameSem = nullptr;
framesize_t currentFrameSize = FRAMESIZE_QVGA;

// STREAM
WiFiClient streamClient;
bool streamActive = false;

// BUFFER CIRCULAIRE UART (évite les blocages)
#define UART_BUF_SIZE     256
char uartTxBuf[UART_BUF_SIZE];
volatile uint16_t uartTxHead = 0;
volatile uint16_t uartTxTail = 0;

void uartSend(const char* msg) {
  // Ajoute au buffer circulaire
  uint16_t len = strlen(msg);
  for (uint16_t i = 0; i < len; i++) {
    uint16_t next = (uartTxHead + 1) % UART_BUF_SIZE;
    if (next == uartTxTail) break; // Buffer plein
    uartTxBuf[uartTxHead] = msg[i];
    uartTxHead = next;
  }
  // Ajoute \n
  uint16_t next = (uartTxHead + 1) % UART_BUF_SIZE;
  if (next != uartTxTail) {
    uartTxBuf[uartTxHead] = '\n';
    uartTxHead = next;
  }
}

void uartFlush() {
  while (uartTxHead != uartTxTail) {
    if (slaveSerial.availableForWrite()) {
      slaveSerial.write(uartTxBuf[uartTxTail]);
      uartTxTail = (uartTxTail + 1) % UART_BUF_SIZE;
    } else {
      break;
    }
  }
}

void camCaptureTask(void* pvParameters) {
  for (;;) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) {
      portENTER_CRITICAL(&frameMux);
      camera_fb_t* old = latestFrame;
      latestFrame = fb;
      portEXIT_CRITICAL(&frameMux);
      if (old) esp_camera_fb_return(old);
      xSemaphoreGive(frameSem);
    }
    vTaskDelay(pdMS_TO_TICKS(30));
  }
}

// =============================================================================
// STREAM MJPEG
// =============================================================================
void handleStream() {
  streamClient = server.client();
  if (!streamClient) return;
  
  streamClient.println("HTTP/1.1 200 OK");
  streamClient.println("Content-Type: multipart/x-mixed-replace; boundary=frame");
  streamClient.println("Access-Control-Allow-Origin: *");
  streamClient.println("Cache-Control: no-cache");
  streamClient.println("Connection: keep-alive");
  streamClient.println();
  streamActive = true;
  Serial.println("[STREAM] Client connecte");
}

// =============================================================================
// CAPTURE PHOTO
// =============================================================================
void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Capture echoue");
    return;
  }
  
  server.sendHeader("Content-Type", "image/jpeg");
  server.sendHeader("Content-Disposition", "attachment; filename=\"S3PTZ_" + String(millis()) + ".jpg\"");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  
  esp_camera_fb_return(fb);
  Serial.println("[CAM] Photo snapshot envoyee");
}

// =============================================================================
// CAPTURE HD NATIVE
// =============================================================================
void handleCaptureHD() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) {
    server.send(500, "text/plain", "Camera indisponible");
    return;
  }
  
  framesize_t savedSize = currentFrameSize;
  int savedQuality = s->status.quality;
  
  // Pause capture task
  vTaskSuspendAll();
  
  s->set_framesize(s, HD_FRAME_SIZE);
  s->set_quality(s, HD_QUALITY);
  s->set_sharpness(s, 2);
  
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) esp_camera_fb_return(fb);
  
  delay(250);
  
  fb = esp_camera_fb_get();
  
  s->set_framesize(s, savedSize);
  s->set_quality(s, savedQuality);
  
  xTaskResumeAll();
  
  if (!fb) {
    server.send(500, "text/plain", "Capture echoue");
    return;
  }
  
  server.sendHeader("Content-Type", "image/jpeg");
  server.sendHeader("Content-Disposition", "attachment; filename=\"S3PTZ_HD_" + String(millis()) + ".jpg\"");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  
  esp_camera_fb_return(fb);
  Serial.println("[CAM] Capture HD envoyee");
}

// =============================================================================
// COMMANDE PTZ — ENVOI IMMÉDIAT VIA BUFFER
// =============================================================================
void handleCmd() {
  if (!server.hasArg("plain")) {
    server.send(400, "text/plain", "Corps manquant");
    return;
  }
  
  String cmd = server.arg("plain");
  cmd.trim();
  
  if (cmd.length() == 0) {
    server.send(400, "text/plain", "Corps vide");
    return;
  }
  
  Serial.printf("[HTTP RX] '%s'\n", cmd.c_str());
  
  bool valid = (cmd == "HOME") || (cmd == "CENTER") ||
               (cmd.startsWith("H:") && cmd.length() <= 10) ||
               (cmd.startsWith("V:") && cmd.length() <= 10) ||
               (cmd == "TEST") || (cmd == "STATUS") ||
               (cmd == "START_PAN_LEFT") || (cmd == "START_PAN_RIGHT") ||
               (cmd == "START_TILT_UP") || (cmd == "START_TILT_DOWN") ||
               (cmd == "STOP_PAN") || (cmd == "STOP_TILT");
               
  if (valid) {
    uartSend(cmd.c_str());
    Serial.printf("[UART TX] '%s' -> esclave\n", cmd.c_str());
    server.send(200, "text/plain", "OK");
  } else {
    server.send(400, "text/plain", "Commande inconnue");
  }
}

// =============================================================================
// RÉSOLUTION
// =============================================================================
void handleSetRes() {
  if (!server.hasArg("plain")) {
    server.send(400, "text/plain", "Corps manquant");
    return;
  }
  
  String res = server.arg("plain");
  res.trim();
  
  sensor_t* s = esp_camera_sensor_get();
  if (!s) {
    server.send(500, "text/plain", "Capteur indisponible");
    return;
  }
  
  framesize_t newSize;
  if (res == "QVGA") newSize = FRAMESIZE_QVGA;
  else if (res == "VGA") newSize = FRAMESIZE_VGA;
  else if (res == "SVGA") newSize = FRAMESIZE_SVGA;
  else if (res == "XGA") newSize = FRAMESIZE_XGA;
  else if (res == "HD") newSize = FRAMESIZE_HD;
  else if (res == "FHD") newSize = FRAMESIZE_FHD;
  else {
    server.send(400, "text/plain", "Resolutions: QVGA,VGA,SVGA,XGA,HD,FHD");
    return;
  }
  
  streamActive = false;
  if (streamClient) streamClient.stop();
  delay(100);
  
  s->set_framesize(s, newSize);
  currentFrameSize = newSize;
  
  portENTER_CRITICAL(&frameMux);
  camera_fb_t* old = latestFrame;
  latestFrame = nullptr;
  portEXIT_CRITICAL(&frameMux);
  if (old) esp_camera_fb_return(old);
  
  delay(200);
  
  Serial.printf("[CAM] Resolution: %s\n", res.c_str());
  server.send(200, "text/plain", "OK " + res);
}

// =============================================================================
// QUALITÉ
// =============================================================================
void handleSetQuality() {
  if (!server.hasArg("plain")) {
    server.send(400, "text/plain", "Corps manquant");
    return;
  }
  
  int q = server.arg("plain").toInt();
  if (q < 4 || q > 63) {
    server.send(400, "text/plain", "Qualite: 4-63");
    return;
  }
  
  sensor_t* s = esp_camera_sensor_get();
  if (!s) {
    server.send(500, "text/plain", "Erreur capteur");
    return;
  }
  
  streamActive = false;
  if (streamClient) streamClient.stop();
  delay(50);
  
  s->set_quality(s, q);
  delay(100);
  
  Serial.printf("[CAM] Qualite: %d\n", q);
  server.send(200, "text/plain", "OK " + String(q));
}

// =============================================================================
// PARAMÈTRES AVANCÉS
// =============================================================================
void handleSetParams() {
  if (!server.hasArg("plain")) {
    server.send(400, "text/plain", "Corps manquant");
    return;
  }
  
  String body = server.arg("plain");
  body.trim();
  
  sensor_t* s = esp_camera_sensor_get();
  if (!s) {
    server.send(500, "text/plain", "Capteur indisponible");
    return;
  }
  
  int brightness = 0, contrast = 0, saturation = 0, sharpness = 0;
  
  if (body.indexOf("brightness:") >= 0) {
    int idx = body.indexOf("brightness:") + 11;
    int end = body.indexOf("|", idx);
    if (end < 0) end = body.length();
    brightness = body.substring(idx, end).toInt();
  }
  if (body.indexOf("contrast:") >= 0) {
    int idx = body.indexOf("contrast:") + 9;
    int end = body.indexOf("|", idx);
    if (end < 0) end = body.length();
    contrast = body.substring(idx, end).toInt();
  }
  if (body.indexOf("saturation:") >= 0) {
    int idx = body.indexOf("saturation:") + 11;
    int end = body.indexOf("|", idx);
    if (end < 0) end = body.length();
    saturation = body.substring(idx, end).toInt();
  }
  if (body.indexOf("sharpness:") >= 0) {
    int idx = body.indexOf("sharpness:") + 10;
    int end = body.indexOf("|", idx);
    if (end < 0) end = body.length();
    sharpness = body.substring(idx, end).toInt();
  }
  
  streamActive = false;
  if (streamClient) streamClient.stop();
  delay(50);
  
  if (brightness != 0) s->set_brightness(s, brightness);
  if (contrast != 0) s->set_contrast(s, contrast);
  if (saturation != 0) s->set_saturation(s, saturation);
  if (sharpness != 0) s->set_sharpness(s, sharpness);
  
  delay(100);
  
  Serial.printf("[CAM] Params: b=%d c=%d s=%d sh=%d\n", brightness, contrast, saturation, sharpness);
  server.send(200, "text/plain", "OK params");
}

// =============================================================================
// STATUS
// =============================================================================
void handleStatus() {
  String json = "{\"ip\":\"" + WiFi.localIP().toString() + "\","
                "\"rssi\":" + String(WiFi.RSSI()) + ","
                "\"uptime\":" + String(millis() / 1000) + ","
                "\"stream_active\":" + String(streamActive ? "true" : "false") + "}";
  server.send(200, "application/json", json);
}

// =============================================================================
// OPTIONS CORS
// =============================================================================
void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

// =============================================================================
// PAGE ROOT
// =============================================================================
void handleRoot() {
  String html = R"rawhtml(<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>S3-PRO PTZ</title>
  <link rel="stylesheet" href="https://javabatchcss.github.io/Donamestre/style.css">
</head>
<body>
  <div id="app-root"></div>
  <script src="https://javabatchcss.github.io/Donamestre/app.js"></script>
</body>
</html>)rawhtml";
  server.send(200, "text/html; charset=utf-8", html);
}

// =============================================================================
// WIFI CONFIG
// =============================================================================
bool configWiFi() {
  preferences.begin("wifi_creds", false);
  ssid = preferences.getString("ssid", "");
  password = preferences.getString("password", "");
  bool forcerConfig = false;
  if (ssid != "") {
    Serial.println("\n[SYSTEM] WiFi: " + ssid);
    Serial.println("[SYSTEM] Taper 'C' dans 5s pour modifier");
    unsigned long start = millis();
    while (millis() - start < 5000) {
      if (Serial.available() > 0) {
        char c = Serial.read();
        if (c == 'C' || c == 'c') { forcerConfig = true; break; }
      }
      delay(200); Serial.print(".");
    }
    Serial.println();
  }
  if (ssid == "" || forcerConfig) {
    while (Serial.available()) Serial.read();
    Serial.println("\n=== CONFIGURATION WIFI ===");
    Serial.print("SSID : ");
    while (Serial.available() == 0) delay(100);
    ssid = Serial.readStringUntil('\n'); ssid.trim();
    preferences.putString("ssid", ssid);
    Serial.print("PASSWORD : ");
    while (Serial.available() == 0) delay(100);
    password = Serial.readStringUntil('\n'); password.trim();
    preferences.putString("password", password);
    preferences.end();
    Serial.println("[OK] Sauvegarde Flash. Redemarrage...");
    delay(1000); ESP.restart();
    return false;
  }
  preferences.end();
  Serial.println("[OK] WiFi: " + ssid);
  return true;
}

// =============================================================================
// INIT CAMERA
// =============================================================================
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
    Serial.println("[CAM] PSRAM detectee, QVGA stream");
  } else {
    config.frame_size = FRAMESIZE_QVGA;
    config.jpeg_quality = 15;
    config.fb_count = 1;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] Camera: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    Serial.printf("[CAM] PID=0x%04X\n", s->id.PID);
    s->set_sharpness(s, 2);
    s->set_brightness(s, 1);
    s->set_saturation(s, 1);
    s->set_contrast(s, 1);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_agc_gain(s, 10);
    s->set_lenc(s, 1);
    s->set_hmirror(s, 0);
    s->set_vflip(s, 0);
    s->set_dcw(s, 1);
  }
  Serial.println("[OK] Camera OK");
  return true;
}

// =============================================================================
// CONNECT WIFI
// =============================================================================
bool connectWiFi() {
  if (ssid == "") return false;
  Serial.printf("[WIFI] Connexion %s...\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(WIFI_PS_NONE);
  WiFi.begin(ssid.c_str(), password.c_str());
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t > 30000) {
      Serial.println("\n[ERROR] WiFi timeout");
      return false;
    }
    delay(500); Serial.print(".");
  }
  Serial.printf("\n[WIFI] IP: %s\n", WiFi.localIP().toString().c_str());
  return true;
}

// =============================================================================
// SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== S3-PRO PTZ — MAITRE v3.4 ===");
  Serial.println("[INFO] WebServer standard | Buffer UART | Zero latence");
  Serial.println("[INFO] PAN=1/2 | TILT=1/4");

  if (!configWiFi()) return;

  slaveSerial.begin(UART_BAUD, SERIAL_8N1, UART_SLAVE_RX, UART_SLAVE_TX);
  Serial.printf("[UART] RX=%d, TX=%d @%d bauds\n", UART_SLAVE_RX, UART_SLAVE_TX, UART_BAUD);

  if (!psramFound()) Serial.println("[WARN] PSRAM non detectee");
  else Serial.printf("[OK] PSRAM: %u Ko\n", ESP.getFreePsram() / 1024);

  if (!initCamera()) {
    Serial.println("[FATAL] Camera");
    while (true) delay(1000);
  }

  int retries = 0;
  while (!connectWiFi()) {
    retries++;
    if (retries >= 5) {
      Serial.println("[FATAL] WiFi. Tapez 'C' au boot.");
      while (true) delay(1000);
    }
    Serial.printf("[WIFI] Retry %d/5...\n", retries);
    delay(3000);
  }

  frameSem = xSemaphoreCreateBinary();
  xTaskCreatePinnedToCore(camCaptureTask, "camCapture", 8192, nullptr, 5, nullptr, 0);

  // --- ROUTES ---
  server.on("/", HTTP_GET, handleRoot);
  server.on("/stream", HTTP_GET, handleStream);
  server.on("/capture", HTTP_GET, handleCapture);
  server.on("/capturehd", HTTP_GET, handleCaptureHD);
  server.on("/status", HTTP_GET, handleStatus);
  
  server.on("/cmd", HTTP_POST, handleCmd);
  server.on("/cmd", HTTP_OPTIONS, handleOptions);
  server.on("/setres", HTTP_POST, handleSetRes);
  server.on("/setres", HTTP_OPTIONS, handleOptions);
  server.on("/setquality", HTTP_POST, handleSetQuality);
  server.on("/setquality", HTTP_OPTIONS, handleOptions);
  server.on("/setparams", HTTP_POST, handleSetParams);
  server.on("/setparams", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.printf("[HTTP] http://%s/\n", WiFi.localIP().toString().c_str());
  Serial.println("[READY]");
}

// =============================================================================
// LOOP
// =============================================================================
void loop() {
  server.handleClient();
  
  // Flush buffer UART
  uartFlush();
  
  // Stream MJPEG
  if (streamActive && streamClient.connected()) {
    if (xSemaphoreTake(frameSem, pdMS_TO_TICKS(100)) == pdTRUE) {
      camera_fb_t* fb = nullptr;
      portENTER_CRITICAL(&frameMux);
      fb = latestFrame;
      latestFrame = nullptr;
      portEXIT_CRITICAL(&frameMux);
      if (fb) {
        streamClient.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
        streamClient.write(fb->buf, fb->len);
        streamClient.print("\r\n");
        esp_camera_fb_return(fb);
      }
    }
  } else if (streamActive && !streamClient.connected()) {
    streamActive = false;
    Serial.println("[STREAM] Client deconnecte");
  }
  
  // Lecture logs esclave
  while (slaveSerial.available()) {
    String msg = slaveSerial.readStringUntil('\n');
    msg.trim();
    if (msg.length() > 0) Serial.printf("[UART RX] %s\n", msg.c_str());
  }
  
  // Debug USB
  while (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      Serial.printf("[DEBUG] '%s'\n", cmd.c_str());
      uartSend(cmd.c_str());
    }
  }
  
  // WiFi reconnect
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Reconnexion...");
    WiFi.reconnect();
    delay(5000);
  }
}
