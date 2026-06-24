// =============================================================================
// S3-PRO PTZ — ESCLAVE MOTEURS v3.5
// Séquence pas-à-pas corrigée | Amorçage rotor | Timing adaptatif
// PAN centre=1/2 | TILT centre=1/4 | PAN inversé | TILT normal
// =============================================================================
#include <Arduino.h>
#include <HardwareSerial.h>

// --- UART ---
#define UART_MASTER_RX  44
#define UART_MASTER_TX  43
#define UART_BAUD       115200

// --- MOTEURS ---
const uint8_t PAN_PINS[4]  = {1, 2, 4, 5};
const uint8_t TILT_PINS[4] = {8, 9, 10, 11};

// Fins de course
#define LS_PAN_MIN    6
#define LS_PAN_MAX    7
#define LS_TILT_MIN   13
#define LS_TILT_MAX   12

// INVERSION: PAN inversé, TILT normal
#define INVERT_PAN    true
#define INVERT_TILT   false

// --- SÉQUENCE DEMI-PAS STANDARD (28BYJ-48 / ULN2003) ---
// Ordre: A, AB, B, BC, C, CD, D, DA
const uint8_t STEP_SEQ[8][4] = {
  {1,0,0,0},  // A
  {1,1,0,0},  // AB
  {0,1,0,0},  // B
  {0,1,1,0},  // BC
  {0,0,1,0},  // C
  {0,0,1,1},  // CD
  {0,0,0,1},  // D
  {1,0,0,1}   // DA
};

// TIMING CRITIQUE (en microsecondes)
#define DELAY_START_US      2000    // Amorçage très lent (2ms)
#define DELAY_HOMING_US     1500    // Homing lent et sûr
#define DELAY_MOVE_MIN_US   800     // Minimum absolu pour pas fiable
#define DELAY_MOVE_NORM_US  1200    // Vitesse normale fluide
#define DELAY_CONTINUOUS_US 1000    // Mouvement continu

// PAS
#define STEP_CLICK_MIN      128     // Clic rapide visible
#define STEP_FINE_MIN       64      // Pas fin

HardwareSerial masterSerial(1);

// --- ÉTAT ---
struct MotorState {
  volatile int32_t pos;
  volatile int32_t range;
  volatile int32_t center;
  volatile uint8_t seqIndex;
  volatile bool busy;
  volatile bool homed;
  volatile bool moving;
  volatile int8_t direction;
};

static MotorState panState  = {0, 0, 0, 0, false, false, false, 0};
static MotorState tiltState = {0, 0, 0, 0, false, false, false, 0};

struct MotorCmd {
  int32_t steps;
  bool home;
  bool center;
  bool start;
  bool stop;
  int8_t dir;
};
static QueueHandle_t panQueue  = nullptr;
static QueueHandle_t tiltQueue = nullptr;

// --- UTILITAIRES ---
void logBoth(const char* fmt, ...) {
  char buf[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  Serial.println(buf);
  masterSerial.println(buf);
}

inline void motorOff(const uint8_t pins[4]) {
  for (uint8_t i = 0; i < 4; i++) digitalWrite(pins[i], LOW);
}

// Application d'un pas avec DEBUG optionnel
inline void applyStep(const uint8_t pins[4], uint8_t idx) {
  for (uint8_t i = 0; i < 4; i++) {
    digitalWrite(pins[i], STEP_SEQ[idx][i]);
  }
}

inline bool limitActive(uint8_t pin) {
  return digitalRead(pin) == LOW;
}

int32_t applyInvertPan(int32_t steps) {
  return INVERT_PAN ? -steps : steps;
}

int32_t applyInvertTilt(int32_t steps) {
  return INVERT_TILT ? -steps : steps;
}

// =============================================================================
// PAS UNIQUE AVEC AMORÇAGE ET TIMING ADAPTATIF
// =============================================================================
void doOneStep(const uint8_t pins[4], MotorState &state, bool forward,
               uint8_t limitMin, uint8_t limitMax) {
  // Protection butées
  if (forward && limitActive(limitMax)) { state.moving = false; return; }
  if (!forward && limitActive(limitMin)) { state.moving = false; return; }
  
  if (state.homed) {
    if (forward && state.pos >= state.range) { state.moving = false; return; }
    if (!forward && state.pos <= 0) { state.moving = false; return; }
  }
  
  // Avance/recule dans la séquence
  if (forward) {
    state.seqIndex = (state.seqIndex + 1) % 8;
    state.pos++;
  } else {
    state.seqIndex = (state.seqIndex == 0) ? 7 : state.seqIndex - 1;
    state.pos--;
  }
  
  applyStep(pins, state.seqIndex);
}

// =============================================================================
// MOUVEMENT AVEC AMORÇAGE (démarrage lent puis vitesse normale)
// =============================================================================
void moveWithRamp(const uint8_t pins[4], MotorState &state, int32_t steps,
                  uint8_t limitMin, uint8_t limitMax, const char* name,
                  uint16_t normalDelay) {
  if (steps == 0) return;
  bool forward = (steps > 0);
  int32_t total = abs(steps);
  
  for (int32_t i = 0; i < total; i++) {
    // Amorçage : 8 premiers pas très lents
    uint16_t delayUs;
    if (i < 8) {
      delayUs = DELAY_START_US;           // 2ms pour débloquer le rotor
    } else if (i < 16) {
      delayUs = DELAY_HOMING_US;          // 1.5ms transition
    } else {
      delayUs = normalDelay;              // Vitesse normale
    }
    
    doOneStep(pins, state, forward, limitMin, limitMax);
    delayMicroseconds(delayUs);
    
    // Yield tous les 10 pas
    if (i % 10 == 0) vTaskDelay(1);
  }
  
  motorOff(pins);
}

// =============================================================================
// MOUVEMENT CONTINU (avec amorçage au démarrage)
// =============================================================================
void continuousStep(const uint8_t pins[4], MotorState &state,
                    uint8_t limitMin, uint8_t limitMax, const char* name) {
  static uint32_t stepCount = 0;
  
  if (!state.moving) {
    stepCount = 0;
    return;
  }
  
  // Amorçage au premier pas
  uint16_t delayUs;
  if (stepCount < 8) {
    delayUs = DELAY_START_US;
  } else if (stepCount < 16) {
    delayUs = DELAY_HOMING_US;
  } else {
    delayUs = DELAY_CONTINUOUS_US;
  }
  
  doOneStep(pins, state, state.direction > 0, limitMin, limitMax);
  delayMicroseconds(delayUs);
  stepCount++;
  
  // Yield périodique
  if (stepCount % 10 == 0) vTaskDelay(1);
}

// =============================================================================
// HOMING AVEC CENTRE PAN=1/2, TILT=1/4
// =============================================================================
void doHoming(const uint8_t pins[4], MotorState &state,
              uint8_t limitMin, uint8_t limitMax, const char* name) {
  if (state.busy) return;
  state.busy = true;
  state.homed = false;
  state.moving = false;

  logBoth("\n[%s] === HOMING ===", name);

  // Phase 1: butée MIN
  logBoth("[%s] -> butee MIN...", name);
  motorOff(pins);
  delay(50);  // Attente moteur éteint
  
  if (!limitActive(limitMin)) {
    int32_t timeout = 0;
    while (!limitActive(limitMin)) {
      state.seqIndex = (state.seqIndex == 0) ? 7 : state.seqIndex - 1;
      state.pos--;
      applyStep(pins, state.seqIndex);
      delayMicroseconds(DELAY_HOMING_US);
      if (++timeout > 30000) {
        logBoth("[%s] TIMEOUT MIN!", name);
        motorOff(pins);
        state.busy = false;
        return;
      }
      if (timeout % 5 == 0) vTaskDelay(1);
    }
    motorOff(pins);
  }
  state.pos = 0;
  logBoth("[%s] MIN atteinte", name);
  delay(200);  // Attente stabilisation

  // Dégagement MIN (16 demi-pas pour s'assurer de sortir)
  logBoth("[%s] Degagement MIN...", name);
  for (int i = 0; i < 16; i++) {
    state.seqIndex = (state.seqIndex + 1) % 8;
    state.pos++;
    applyStep(pins, state.seqIndex);
    delayMicroseconds(DELAY_HOMING_US);
  }
  motorOff(pins);
  state.pos = 16;
  delay(200);

  // Phase 2: butée MAX
  logBoth("[%s] -> butee MAX...", name);
  int32_t stepCount = 0;
  if (!limitActive(limitMax)) {
    int32_t timeout = 0;
    while (!limitActive(limitMax)) {
      state.seqIndex = (state.seqIndex + 1) % 8;
      state.pos++;
      applyStep(pins, state.seqIndex);
      delayMicroseconds(DELAY_HOMING_US);
      stepCount++;
      if (++timeout > 40000) {
        logBoth("[%s] TIMEOUT MAX!", name);
        motorOff(pins);
        state.busy = false;
        return;
      }
      if (timeout % 5 == 0) vTaskDelay(1);
    }
    motorOff(pins);
  }
  state.range = stepCount + 16;
  logBoth("[%s] MAX atteinte, course=%d pas", name, state.range);
  delay(200);

  // Dégagement MAX
  logBoth("[%s] Degagement MAX...", name);
  for (int i = 0; i < 16; i++) {
    state.seqIndex = (state.seqIndex == 0) ? 7 : state.seqIndex - 1;
    state.pos--;
    applyStep(pins, state.seqIndex);
    delayMicroseconds(DELAY_HOMING_US);
  }
  motorOff(pins);
  state.pos = state.range - 16;
  delay(200);

  // CENTRE : PAN = 1/2, TILT = 1/4
  if (strcmp(name, "PAN") == 0) {
    state.center = state.range / 2;
    logBoth("[%s] centre=1/2=%d", name, state.center);
  } else {
    state.center = state.range / 4;
    logBoth("[%s] centre=1/4=%d", name, state.center);
  }

  int32_t toCenter = state.center - state.pos;
  logBoth("[%s] deplacement=%d", name, toCenter);

  if (toCenter != 0) {
    moveWithRamp(pins, state, toCenter, limitMin, limitMax, name, DELAY_HOMING_US);
  }

  state.pos = state.center;
  state.homed = true;
  state.busy = false;
  logBoth("[%s] === HOMING OK pos=%d/%d ===", name, state.pos, state.range);
}

void goCenter(const uint8_t pins[4], MotorState &state,
              uint8_t limitMin, uint8_t limitMax, const char* name) {
  if (!state.homed) { logBoth("[%s] ERREUR: homing non fait!", name); return; }
  if (state.busy) { logBoth("[%s] occupe!", name); return; }
  state.busy = true;
  state.moving = false;
  int32_t delta = state.center - state.pos;
  logBoth("[%s] -> centre: %d->%d", name, state.pos, state.center);
  
  moveWithRamp(pins, state, delta, limitMin, limitMax, name, DELAY_HOMING_US);
  
  state.busy = false;
  logBoth("[%s] centre OK pos=%d", name, state.pos);
}

// MOUVEMENT RELATIF AVEC PAS MINIMUM ET RAMP
void moveRelative(const uint8_t pins[4], MotorState &state, int32_t steps,
                  uint8_t limitMin, uint8_t limitMax, const char* name) {
  if (state.busy) { logBoth("[%s] occupe!", name); return; }
  
  // Arrondi multiple de 8
  steps = ((steps + (steps > 0 ? 4 : -4)) / 8) * 8;
  
  // Pas minimum
  if (steps > 0 && steps < STEP_CLICK_MIN) steps = STEP_CLICK_MIN;
  if (steps < 0 && steps > -STEP_CLICK_MIN) steps = -STEP_CLICK_MIN;
  
  if (steps == 0) return;
  
  state.busy = true;
  state.moving = false;
  logBoth("[%s] %+d pas (pos=%d)", name, steps, state.pos);
  
  moveWithRamp(pins, state, steps, limitMin, limitMax, name, DELAY_MOVE_NORM_US);
  
  state.busy = false;
  logBoth("[%s] fini pos=%d/%d", name, state.pos, state.range);
}

// =============================================================================
// MOUVEMENT CONTINU START/STOP
// =============================================================================
void startContinuous(const uint8_t pins[4], MotorState &state, int8_t dir,
                     uint8_t limitMin, uint8_t limitMax, const char* name) {
  if (!state.homed) { logBoth("[%s] ERREUR: homing non fait!", name); return; }
  if (state.busy) return;
  
  state.moving = true;
  state.direction = dir;
  logBoth("[%s] START dir=%+d", name, dir);
}

void stopContinuous(const uint8_t pins[4], MotorState &state, const char* name) {
  state.moving = false;
  state.direction = 0;
  motorOff(pins);
  logBoth("[%s] STOP pos=%d", name, state.pos);
}

// =============================================================================
// TÂCHES MOTEURS
// =============================================================================
void panTask(void* pvParameters) {
  MotorCmd cmd;
  for (;;) {
    if (xQueueReceive(panQueue, &cmd, 0) == pdTRUE) {
      if (cmd.home) {
        stopContinuous(PAN_PINS, panState, "PAN");
        doHoming(PAN_PINS, panState, LS_PAN_MIN, LS_PAN_MAX, "PAN");
      }
      else if (cmd.center) {
        stopContinuous(PAN_PINS, panState, "PAN");
        goCenter(PAN_PINS, panState, LS_PAN_MIN, LS_PAN_MAX, "PAN");
      }
      else if (cmd.start) {
        int8_t dir = applyInvertPan(cmd.dir);
        startContinuous(PAN_PINS, panState, dir, LS_PAN_MIN, LS_PAN_MAX, "PAN");
      }
      else if (cmd.stop) {
        stopContinuous(PAN_PINS, panState, "PAN");
      }
      else {
        stopContinuous(PAN_PINS, panState, "PAN");
        int32_t s = applyInvertPan(cmd.steps);
        moveRelative(PAN_PINS, panState, s, LS_PAN_MIN, LS_PAN_MAX, "PAN");
      }
    }
    
    // Boucle mouvement continu
    if (panState.moving && panState.direction != 0) {
      continuousStep(PAN_PINS, panState, LS_PAN_MIN, LS_PAN_MAX, "PAN");
    } else {
      vTaskDelay(pdMS_TO_TICKS(5));
    }
  }
}

void tiltTask(void* pvParameters) {
  MotorCmd cmd;
  for (;;) {
    if (xQueueReceive(tiltQueue, &cmd, 0) == pdTRUE) {
      if (cmd.home) {
        stopContinuous(TILT_PINS, tiltState, "TILT");
        doHoming(TILT_PINS, tiltState, LS_TILT_MIN, LS_TILT_MAX, "TILT");
      }
      else if (cmd.center) {
        stopContinuous(TILT_PINS, tiltState, "TILT");
        goCenter(TILT_PINS, tiltState, LS_TILT_MIN, LS_TILT_MAX, "TILT");
      }
      else if (cmd.start) {
        int8_t dir = applyInvertTilt(cmd.dir);
        startContinuous(TILT_PINS, tiltState, dir, LS_TILT_MIN, LS_TILT_MAX, "TILT");
      }
      else if (cmd.stop) {
        stopContinuous(TILT_PINS, tiltState, "TILT");
      }
      else {
        stopContinuous(TILT_PINS, tiltState, "TILT");
        int32_t s = applyInvertTilt(cmd.steps);
        moveRelative(TILT_PINS, tiltState, s, LS_TILT_MIN, LS_TILT_MAX, "TILT");
      }
    }
    
    if (tiltState.moving && tiltState.direction != 0) {
      continuousStep(TILT_PINS, tiltState, LS_TILT_MIN, LS_TILT_MAX, "TILT");
    } else {
      vTaskDelay(pdMS_TO_TICKS(5));
    }
  }
}

// =============================================================================
// PARSER COMMANDES
// =============================================================================
void processCommand(const String& line, const char* source) {
  String clean = "";
  for (int i = 0; i < line.length(); i++) {
    char c = line[i];
    if (c >= 32 && c <= 126) clean += c;
  }
  clean.trim();
  if (clean.length() == 0) return;
  
  logBoth("[%s] CMD: '%s'", source, clean.c_str());
  
  if (clean == "HOME") {
    MotorCmd c = {0, true, false, false, false, 0};
    xQueueSend(panQueue, &c, pdMS_TO_TICKS(100));
    xQueueSend(tiltQueue, &c, pdMS_TO_TICKS(100));
    logBoth("[OK] HOME lance");
    return;
  }
  if (clean == "CENTER") {
    MotorCmd c = {0, false, true, false, false, 0};
    xQueueSend(panQueue, &c, pdMS_TO_TICKS(100));
    xQueueSend(tiltQueue, &c, pdMS_TO_TICKS(100));
    logBoth("[OK] CENTER");
    return;
  }
  if (clean == "START_PAN_LEFT") {
    MotorCmd c = {0, false, false, true, false, -1};
    xQueueSend(panQueue, &c, pdMS_TO_TICKS(100));
    return;
  }
  if (clean == "START_PAN_RIGHT") {
    MotorCmd c = {0, false, false, true, false, +1};
    xQueueSend(panQueue, &c, pdMS_TO_TICKS(100));
    return;
  }
  if (clean == "START_TILT_UP") {
    MotorCmd c = {0, false, false, true, false, +1};
    xQueueSend(tiltQueue, &c, pdMS_TO_TICKS(100));
    return;
  }
  if (clean == "START_TILT_DOWN") {
    MotorCmd c = {0, false, false, true, false, -1};
    xQueueSend(tiltQueue, &c, pdMS_TO_TICKS(100));
    return;
  }
  if (clean == "STOP_PAN") {
    MotorCmd c = {0, false, false, false, true, 0};
    xQueueSend(panQueue, &c, pdMS_TO_TICKS(100));
    return;
  }
  if (clean == "STOP_TILT") {
    MotorCmd c = {0, false, false, false, true, 0};
    xQueueSend(tiltQueue, &c, pdMS_TO_TICKS(100));
    return;
  }
  if (clean.startsWith("H:")) {
    int32_t steps = clean.substring(2).toInt();
    MotorCmd c = {steps, false, false, false, false, 0};
    if (xQueueSend(panQueue, &c, pdMS_TO_TICKS(100)) == pdTRUE)
      logBoth("[OK] PAN %+d", steps);
    else logBoth("[ERR] File PAN pleine");
    return;
  }
  if (clean.startsWith("V:")) {
    int32_t steps = clean.substring(2).toInt();
    MotorCmd c = {steps, false, false, false, false, 0};
    if (xQueueSend(tiltQueue, &c, pdMS_TO_TICKS(100)) == pdTRUE)
      logBoth("[OK] TILT %+d", steps);
    else logBoth("[ERR] File TILT pleine");
    return;
  }
  if (clean == "TEST") {
    logBoth("[TEST] Test PAN...");
    moveWithRamp(PAN_PINS, panState, 64, LS_PAN_MIN, LS_PAN_MAX, "PAN", DELAY_MOVE_NORM_US);
    motorOff(PAN_PINS); delay(300);
    logBoth("[TEST] Test TILT...");
    moveWithRamp(TILT_PINS, tiltState, 64, LS_TILT_MIN, LS_TILT_MAX, "TILT", DELAY_MOVE_NORM_US);
    motorOff(TILT_PINS);
    logBoth("[TEST] OK");
    return;
  }
  if (clean == "STATUS") {
    logBoth("[STATUS] PAN=%d/%d homed=%s moving=%s | TILT=%d/%d homed=%s moving=%s",
      panState.pos, panState.range, panState.homed?"OUI":"NON", panState.moving?"OUI":"NON",
      tiltState.pos, tiltState.range, tiltState.homed?"OUI":"NON", tiltState.moving?"OUI":"NON");
    return;
  }
  logBoth("[WARN] Inconnu: '%s'", clean.c_str());
}

void uartTask(void* pvParameters) {
  String buf = "";
  for (;;) {
    while (masterSerial.available()) {
      char c = (char)masterSerial.read();
      if (c == '\n' || c == '\r') {
        if (buf.length() > 0) { processCommand(buf, "UART"); buf = ""; }
      } else if (buf.length() < 64) { buf += c; }
    }
    vTaskDelay(pdMS_TO_TICKS(3));
  }
}

void usbTask(void* pvParameters) {
  String buf = "";
  for (;;) {
    while (Serial.available()) {
      char c = (char)Serial.read();
      if (c == '\n' || c == '\r') {
        if (buf.length() > 0) { processCommand(buf, "USB"); buf = ""; }
      } else if (buf.length() < 64) { buf += c; }
    }
    vTaskDelay(pdMS_TO_TICKS(3));
  }
}

// =============================================================================
// SETUP
// =============================================================================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== S3-PRO PTZ ESCLAVE v3.5 ===");
  Serial.println("Amorcage rotor | Timing adaptatif | PAN=1/2 | TILT=1/4");

  masterSerial.begin(UART_BAUD, SERIAL_8N1, UART_MASTER_RX, UART_MASTER_TX);
  Serial.printf("[UART] RX=%d TX=%d @%d bauds\n", UART_MASTER_RX, UART_MASTER_TX, UART_BAUD);

  // Init pins moteur à LOW
  for (uint8_t i = 0; i < 4; i++) {
    pinMode(PAN_PINS[i], OUTPUT);
    digitalWrite(PAN_PINS[i], LOW);
    pinMode(TILT_PINS[i], OUTPUT);
    digitalWrite(TILT_PINS[i], LOW);
  }
  Serial.println("[OK] Moteurs OFF");

  // Fins de course
  pinMode(LS_PAN_MIN, INPUT_PULLUP);
  pinMode(LS_PAN_MAX, INPUT_PULLUP);
  pinMode(LS_TILT_MIN, INPUT_PULLUP);
  pinMode(LS_TILT_MAX, INPUT_PULLUP);

  Serial.println("\n[INIT] Etat butees:");
  Serial.printf("  PAN  MIN(%d):%s MAX(%d):%s\n", 
    LS_PAN_MIN, limitActive(LS_PAN_MIN)?"ACTIVE":"libre",
    LS_PAN_MAX, limitActive(LS_PAN_MAX)?"ACTIVE":"libre");
  Serial.printf("  TILT MIN(%d):%s MAX(%d):%s\n",
    LS_TILT_MIN, limitActive(LS_TILT_MIN)?"ACTIVE":"libre",
    LS_TILT_MAX, limitActive(LS_TILT_MAX)?"ACTIVE":"libre");

  // Files de commandes
  panQueue = xQueueCreate(8, sizeof(MotorCmd));
  tiltQueue = xQueueCreate(8, sizeof(MotorCmd));

  // Tâches
  xTaskCreatePinnedToCore(panTask,  "pan",  4096, nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(tiltTask, "tilt", 4096, nullptr, 5, nullptr, 1);
  xTaskCreatePinnedToCore(uartTask, "uart", 4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(usbTask,  "usb",  4096, nullptr, 3, nullptr, 1);

  // Homing auto
  Serial.println("\n[READY] Homing auto dans 3 secondes...");
  delay(3000);
  
  MotorCmd homeCmd = {0, true, false, false, false, 0};
  
  xQueueSend(panQueue, &homeCmd, portMAX_DELAY);
  Serial.println("[AUTO] Homing PAN...");
  while (panState.busy) { vTaskDelay(50); }
  
  xQueueSend(tiltQueue, &homeCmd, portMAX_DELAY);
  Serial.println("[AUTO] Homing TILT...");
  while (tiltState.busy) { vTaskDelay(50); }
  
  Serial.println("\n[AUTO] Homing complet! Systeme pret.");
}

void loop() {
  static unsigned long last = 0;
  if (millis() - last > 30000) {
    last = millis();
    logBoth("[STATUS] PAN=%d/%d TILT=%d/%d",
      panState.pos, panState.range, tiltState.pos, tiltState.range);
  }
  delay(100);
}
