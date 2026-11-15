(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/ts-fsrs/dist/index.mjs
  var State = /* @__PURE__ */ ((State2) => {
    State2[State2["New"] = 0] = "New";
    State2[State2["Learning"] = 1] = "Learning";
    State2[State2["Review"] = 2] = "Review";
    State2[State2["Relearning"] = 3] = "Relearning";
    return State2;
  })(State || {});
  var Rating = /* @__PURE__ */ ((Rating2) => {
    Rating2[Rating2["Manual"] = 0] = "Manual";
    Rating2[Rating2["Again"] = 1] = "Again";
    Rating2[Rating2["Hard"] = 2] = "Hard";
    Rating2[Rating2["Good"] = 3] = "Good";
    Rating2[Rating2["Easy"] = 4] = "Easy";
    return Rating2;
  })(Rating || {});
  var TypeConvert = class _TypeConvert {
    static card(card) {
      return {
        ...card,
        state: _TypeConvert.state(card.state),
        due: _TypeConvert.time(card.due),
        last_review: card.last_review ? _TypeConvert.time(card.last_review) : void 0
      };
    }
    static rating(value) {
      if (typeof value === "string") {
        const firstLetter = value.charAt(0).toUpperCase();
        const restOfString = value.slice(1).toLowerCase();
        const ret = Rating[`${firstLetter}${restOfString}`];
        if (ret === void 0) {
          throw new Error(`Invalid rating:[${value}]`);
        }
        return ret;
      } else if (typeof value === "number") {
        return value;
      }
      throw new Error(`Invalid rating:[${value}]`);
    }
    static state(value) {
      if (typeof value === "string") {
        const firstLetter = value.charAt(0).toUpperCase();
        const restOfString = value.slice(1).toLowerCase();
        const ret = State[`${firstLetter}${restOfString}`];
        if (ret === void 0) {
          throw new Error(`Invalid state:[${value}]`);
        }
        return ret;
      } else if (typeof value === "number") {
        return value;
      }
      throw new Error(`Invalid state:[${value}]`);
    }
    static time(value) {
      const date = new Date(value);
      if (typeof value === "object" && value !== null && !Number.isNaN(Date.parse(value) || +date)) {
        return date;
      } else if (typeof value === "string") {
        const timestamp = Date.parse(value);
        if (!Number.isNaN(timestamp)) {
          return new Date(timestamp);
        } else {
          throw new Error(`Invalid date:[${value}]`);
        }
      } else if (typeof value === "number") {
        return new Date(value);
      }
      throw new Error(`Invalid date:[${value}]`);
    }
    static review_log(log) {
      return {
        ...log,
        due: _TypeConvert.time(log.due),
        rating: _TypeConvert.rating(log.rating),
        state: _TypeConvert.state(log.state),
        review: _TypeConvert.time(log.review)
      };
    }
  };
  Date.prototype.scheduler = function(t, isDay) {
    return date_scheduler(this, t, isDay);
  };
  Date.prototype.diff = function(pre, unit) {
    return date_diff(this, pre, unit);
  };
  Date.prototype.format = function() {
    return formatDate(this);
  };
  Date.prototype.dueFormat = function(last_review, unit, timeUnit) {
    return show_diff_message(this, last_review, unit, timeUnit);
  };
  function date_scheduler(now, t, isDay) {
    return new Date(
      isDay ? TypeConvert.time(now).getTime() + t * 24 * 60 * 60 * 1e3 : TypeConvert.time(now).getTime() + t * 60 * 1e3
    );
  }
  function date_diff(now, pre, unit) {
    if (!now || !pre) {
      throw new Error("Invalid date");
    }
    const diff = TypeConvert.time(now).getTime() - TypeConvert.time(pre).getTime();
    let r = 0;
    switch (unit) {
      case "days":
        r = Math.floor(diff / (24 * 60 * 60 * 1e3));
        break;
      case "minutes":
        r = Math.floor(diff / (60 * 1e3));
        break;
    }
    return r;
  }
  function formatDate(dateInput) {
    const date = TypeConvert.time(dateInput);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    return `${year}-${padZero(month)}-${padZero(day)} ${padZero(hours)}:${padZero(
      minutes
    )}:${padZero(seconds)}`;
  }
  function padZero(num) {
    return num < 10 ? `0${num}` : `${num}`;
  }
  var TIMEUNIT = [60, 60, 24, 31, 12];
  var TIMEUNITFORMAT = ["second", "min", "hour", "day", "month", "year"];
  function show_diff_message(due, last_review, unit, timeUnit = TIMEUNITFORMAT) {
    due = TypeConvert.time(due);
    last_review = TypeConvert.time(last_review);
    if (timeUnit.length !== TIMEUNITFORMAT.length) {
      timeUnit = TIMEUNITFORMAT;
    }
    let diff = due.getTime() - last_review.getTime();
    let i = 0;
    diff /= 1e3;
    for (i = 0; i < TIMEUNIT.length; i++) {
      if (diff < TIMEUNIT[i]) {
        break;
      } else {
        diff /= TIMEUNIT[i];
      }
    }
    return `${Math.floor(diff)}${unit ? timeUnit[i] : ""}`;
  }
  var Grades = Object.freeze([
    Rating.Again,
    Rating.Hard,
    Rating.Good,
    Rating.Easy
  ]);
  var FUZZ_RANGES = [
    {
      start: 2.5,
      end: 7,
      factor: 0.15
    },
    {
      start: 7,
      end: 20,
      factor: 0.1
    },
    {
      start: 20,
      end: Infinity,
      factor: 0.05
    }
  ];
  function get_fuzz_range(interval, elapsed_days, maximum_interval) {
    let delta = 1;
    for (const range of FUZZ_RANGES) {
      delta += range.factor * Math.max(Math.min(interval, range.end) - range.start, 0);
    }
    interval = Math.min(interval, maximum_interval);
    let min_ivl = Math.max(2, Math.round(interval - delta));
    const max_ivl = Math.min(Math.round(interval + delta), maximum_interval);
    if (interval > elapsed_days) {
      min_ivl = Math.max(min_ivl, elapsed_days + 1);
    }
    min_ivl = Math.min(min_ivl, max_ivl);
    return { min_ivl, max_ivl };
  }
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function dateDiffInDays(last, cur) {
    const utc1 = Date.UTC(
      last.getUTCFullYear(),
      last.getUTCMonth(),
      last.getUTCDate()
    );
    const utc2 = Date.UTC(
      cur.getUTCFullYear(),
      cur.getUTCMonth(),
      cur.getUTCDate()
    );
    return Math.floor(
      (utc2 - utc1) / 864e5
      /** 1000 * 60 * 60 * 24*/
    );
  }
  var ConvertStepUnitToMinutes = (step) => {
    const unit = step.slice(-1);
    const value = parseInt(step.slice(0, -1), 10);
    if (Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid step value: ${step}`);
    }
    switch (unit) {
      case "m":
        return value;
      case "h":
        return value * 60;
      case "d":
        return value * 1440;
      default:
        throw new Error(`Invalid step unit: ${step}, expected m/h/d`);
    }
  };
  var BasicLearningStepsStrategy = (params, state, cur_step) => {
    const learning_steps = state === State.Relearning || state === State.Review ? params.relearning_steps : params.learning_steps;
    const steps_length = learning_steps.length;
    if (steps_length === 0 || cur_step >= steps_length) return {};
    const firstStep = learning_steps[0];
    const toMinutes = ConvertStepUnitToMinutes;
    const getAgainInterval = () => {
      return toMinutes(firstStep);
    };
    const getHardInterval = () => {
      if (steps_length === 1) return Math.round(toMinutes(firstStep) * 1.5);
      const nextStep = learning_steps[1];
      return Math.round((toMinutes(firstStep) + toMinutes(nextStep)) / 2);
    };
    const getStepInfo = (index) => {
      if (index < 0 || index >= steps_length) {
        return null;
      } else {
        return learning_steps[index];
      }
    };
    const getGoodMinutes = (step) => {
      return toMinutes(step);
    };
    const result = {};
    const step_info = getStepInfo(Math.max(0, cur_step));
    if (state === State.Review) {
      result[Rating.Again] = {
        scheduled_minutes: toMinutes(step_info),
        next_step: 0
      };
      return result;
    } else {
      result[Rating.Again] = {
        scheduled_minutes: getAgainInterval(),
        next_step: 0
      };
      result[Rating.Hard] = {
        scheduled_minutes: getHardInterval(),
        next_step: cur_step
      };
      const next_info = getStepInfo(cur_step + 1);
      if (next_info) {
        const nextMin = getGoodMinutes(next_info);
        if (nextMin) {
          result[Rating.Good] = {
            scheduled_minutes: Math.round(nextMin),
            next_step: cur_step + 1
          };
        }
      }
    }
    return result;
  };
  function DefaultInitSeedStrategy() {
    const time = this.review_time.getTime();
    const reps = this.current.reps;
    const mul = this.current.difficulty * this.current.stability;
    return `${time}_${reps}_${mul}`;
  }
  var StrategyMode = /* @__PURE__ */ ((StrategyMode2) => {
    StrategyMode2["SCHEDULER"] = "Scheduler";
    StrategyMode2["LEARNING_STEPS"] = "LearningSteps";
    StrategyMode2["SEED"] = "Seed";
    return StrategyMode2;
  })(StrategyMode || {});
  var AbstractScheduler = class {
    // init
    constructor(card, now, algorithm, strategies) {
      __publicField(this, "last");
      __publicField(this, "current");
      __publicField(this, "review_time");
      __publicField(this, "next", /* @__PURE__ */ new Map());
      __publicField(this, "algorithm");
      __publicField(this, "strategies");
      __publicField(this, "elapsed_days", 0);
      this.algorithm = algorithm;
      this.last = TypeConvert.card(card);
      this.current = TypeConvert.card(card);
      this.review_time = TypeConvert.time(now);
      this.strategies = strategies;
      this.init();
    }
    checkGrade(grade) {
      if (!Number.isFinite(grade) || grade < 0 || grade > 4) {
        throw new Error(`Invalid grade "${grade}",expected 1-4`);
      }
    }
    init() {
      const { state, last_review } = this.current;
      let interval = 0;
      if (state !== State.New && last_review) {
        interval = dateDiffInDays(last_review, this.review_time);
      }
      this.current.last_review = this.review_time;
      this.elapsed_days = interval;
      this.current.elapsed_days = interval;
      this.current.reps += 1;
      let seed_strategy = DefaultInitSeedStrategy;
      if (this.strategies) {
        const custom_strategy = this.strategies.get(StrategyMode.SEED);
        if (custom_strategy) {
          seed_strategy = custom_strategy;
        }
      }
      this.algorithm.seed = seed_strategy.call(this);
    }
    preview() {
      return {
        [Rating.Again]: this.review(Rating.Again),
        [Rating.Hard]: this.review(Rating.Hard),
        [Rating.Good]: this.review(Rating.Good),
        [Rating.Easy]: this.review(Rating.Easy),
        [Symbol.iterator]: this.previewIterator.bind(this)
      };
    }
    *previewIterator() {
      for (const grade of Grades) {
        yield this.review(grade);
      }
    }
    review(grade) {
      const { state } = this.last;
      let item;
      this.checkGrade(grade);
      switch (state) {
        case State.New:
          item = this.newState(grade);
          break;
        case State.Learning:
        case State.Relearning:
          item = this.learningState(grade);
          break;
        case State.Review:
          item = this.reviewState(grade);
          break;
      }
      return item;
    }
    buildLog(rating) {
      const { last_review, due, elapsed_days } = this.last;
      return {
        rating,
        state: this.current.state,
        due: last_review || due,
        stability: this.current.stability,
        difficulty: this.current.difficulty,
        elapsed_days: this.elapsed_days,
        last_elapsed_days: elapsed_days,
        scheduled_days: this.current.scheduled_days,
        learning_steps: this.current.learning_steps,
        review: this.review_time
      };
    }
  };
  var Alea = class {
    constructor(seed) {
      __publicField(this, "c");
      __publicField(this, "s0");
      __publicField(this, "s1");
      __publicField(this, "s2");
      const mash = Mash();
      this.c = 1;
      this.s0 = mash(" ");
      this.s1 = mash(" ");
      this.s2 = mash(" ");
      if (seed == null) seed = Date.now();
      this.s0 -= mash(seed);
      if (this.s0 < 0) this.s0 += 1;
      this.s1 -= mash(seed);
      if (this.s1 < 0) this.s1 += 1;
      this.s2 -= mash(seed);
      if (this.s2 < 0) this.s2 += 1;
    }
    next() {
      const t = 2091639 * this.s0 + this.c * 23283064365386963e-26;
      this.s0 = this.s1;
      this.s1 = this.s2;
      this.c = t | 0;
      this.s2 = t - this.c;
      return this.s2;
    }
    set state(state) {
      this.c = state.c;
      this.s0 = state.s0;
      this.s1 = state.s1;
      this.s2 = state.s2;
    }
    get state() {
      return {
        c: this.c,
        s0: this.s0,
        s1: this.s1,
        s2: this.s2
      };
    }
  };
  function Mash() {
    let n = 4022871197;
    return function mash(data) {
      data = String(data);
      for (let i = 0; i < data.length; i++) {
        n += data.charCodeAt(i);
        let h = 0.02519603282416938 * n;
        n = h >>> 0;
        h -= n;
        h *= n;
        n = h >>> 0;
        h -= n;
        n += h * 4294967296;
      }
      return (n >>> 0) * 23283064365386963e-26;
    };
  }
  function alea(seed) {
    const xg = new Alea(seed);
    const prng = () => xg.next();
    prng.int32 = () => xg.next() * 4294967296 | 0;
    prng.double = () => prng() + (prng() * 2097152 | 0) * 11102230246251565e-32;
    prng.state = () => xg.state;
    prng.importState = (state) => {
      xg.state = state;
      return prng;
    };
    return prng;
  }
  var version = "5.2.3";
  var default_request_retention = 0.9;
  var default_maximum_interval = 36500;
  var default_enable_fuzz = false;
  var default_enable_short_term = true;
  var default_learning_steps = Object.freeze([
    "1m",
    "10m"
  ]);
  var default_relearning_steps = Object.freeze([
    "10m"
  ]);
  var FSRSVersion = `v${version} using FSRS-6.0`;
  var S_MIN = 1e-3;
  var INIT_S_MAX = 100;
  var FSRS5_DEFAULT_DECAY = 0.5;
  var FSRS6_DEFAULT_DECAY = 0.1542;
  var default_w = Object.freeze([
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    1e-3,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    FSRS6_DEFAULT_DECAY
  ]);
  var W17_W18_Ceiling = 2;
  var CLAMP_PARAMETERS = (w17_w18_ceiling, enable_short_term = default_enable_short_term) => [
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [S_MIN, INIT_S_MAX],
    [1, 10],
    [1e-3, 4],
    [1e-3, 4],
    [1e-3, 0.75],
    [0, 4.5],
    [0, 0.8],
    [1e-3, 3.5],
    [1e-3, 5],
    [1e-3, 0.25],
    [1e-3, 0.9],
    [0, 4],
    [0, 1],
    [1, 6],
    [0, w17_w18_ceiling],
    [0, w17_w18_ceiling],
    [
      enable_short_term ? 0.01 : 0,
      0.8
    ],
    [0.1, 0.8]
  ];
  var clipParameters = (parameters, numRelearningSteps, enableShortTerm = default_enable_short_term) => {
    let w17_w18_ceiling = W17_W18_Ceiling;
    if (Math.max(0, numRelearningSteps) > 1) {
      const value = -(Math.log(parameters[11]) + Math.log(Math.pow(2, parameters[13]) - 1) + parameters[14] * 0.3) / numRelearningSteps;
      w17_w18_ceiling = clamp(+value.toFixed(8), 0.01, 2);
    }
    const clip = CLAMP_PARAMETERS(w17_w18_ceiling, enableShortTerm).slice(
      0,
      parameters.length
    );
    return clip.map(
      ([min, max], index) => clamp(parameters[index] || 0, min, max)
    );
  };
  var migrateParameters = (parameters, numRelearningSteps = 0, enableShortTerm = default_enable_short_term) => {
    if (parameters === void 0) {
      return [...default_w];
    }
    switch (parameters.length) {
      case 21:
        return clipParameters(
          Array.from(parameters),
          numRelearningSteps,
          enableShortTerm
        );
      case 19:
        console.debug("[FSRS-6]auto fill w from 19 to 21 length");
        return clipParameters(
          Array.from(parameters),
          numRelearningSteps,
          enableShortTerm
        ).concat([0, FSRS5_DEFAULT_DECAY]);
      case 17: {
        const w = clipParameters(
          Array.from(parameters),
          numRelearningSteps,
          enableShortTerm
        );
        w[4] = +(w[5] * 2 + w[4]).toFixed(8);
        w[5] = +(Math.log(w[5] * 3 + 1) / 3).toFixed(8);
        w[6] = +(w[6] + 0.5).toFixed(8);
        console.debug("[FSRS-6]auto fill w from 17 to 21 length");
        return w.concat([0, 0, 0, FSRS5_DEFAULT_DECAY]);
      }
      default:
        console.warn("[FSRS]Invalid parameters length, using default parameters");
        return [...default_w];
    }
  };
  var generatorParameters = (props) => {
    const learning_steps = Array.isArray(props?.learning_steps) ? props.learning_steps : default_learning_steps;
    const relearning_steps = Array.isArray(props?.relearning_steps) ? props.relearning_steps : default_relearning_steps;
    const enable_short_term = props?.enable_short_term ?? default_enable_short_term;
    const w = migrateParameters(
      props?.w,
      relearning_steps.length,
      enable_short_term
    );
    return {
      request_retention: props?.request_retention || default_request_retention,
      maximum_interval: props?.maximum_interval || default_maximum_interval,
      w,
      enable_fuzz: props?.enable_fuzz ?? default_enable_fuzz,
      enable_short_term,
      learning_steps,
      relearning_steps
    };
  };
  function createEmptyCard(now, afterHandler) {
    const emptyCard = {
      due: now ? TypeConvert.time(now) : /* @__PURE__ */ new Date(),
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      learning_steps: 0,
      state: State.New,
      last_review: void 0
    };
    if (afterHandler && typeof afterHandler === "function") {
      return afterHandler(emptyCard);
    } else {
      return emptyCard;
    }
  }
  var computeDecayFactor = (decayOrParams) => {
    const decay = typeof decayOrParams === "number" ? -decayOrParams : -decayOrParams[20];
    const factor = Math.exp(Math.pow(decay, -1) * Math.log(0.9)) - 1;
    return { decay, factor: +factor.toFixed(8) };
  };
  function forgetting_curve(decayOrParams, elapsed_days, stability) {
    const { decay, factor } = computeDecayFactor(decayOrParams);
    return +Math.pow(1 + factor * elapsed_days / stability, decay).toFixed(8);
  }
  var FSRSAlgorithm = class {
    constructor(params) {
      __publicField(this, "param");
      __publicField(this, "intervalModifier");
      __publicField(this, "_seed");
      /**
       * The formula used is :
       * $$R(t,S) = (1 + \text{FACTOR} \times \frac{t}{9 \cdot S})^{\text{DECAY}}$$
       * @param {number} elapsed_days t days since the last review
       * @param {number} stability Stability (interval when R=90%)
       * @return {number} r Retrievability (probability of recall)
       */
      __publicField(this, "forgetting_curve");
      this.param = new Proxy(
        generatorParameters(params),
        this.params_handler_proxy()
      );
      this.intervalModifier = this.calculate_interval_modifier(
        this.param.request_retention
      );
      this.forgetting_curve = forgetting_curve.bind(this, this.param.w);
    }
    get interval_modifier() {
      return this.intervalModifier;
    }
    set seed(seed) {
      this._seed = seed;
    }
    /**
     * @see https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm#fsrs-5
     *
     * The formula used is: $$I(r,s) = (r^{\frac{1}{DECAY}} - 1) / FACTOR \times s$$
     * @param request_retention 0<request_retention<=1,Requested retention rate
     * @throws {Error} Requested retention rate should be in the range (0,1]
     */
    calculate_interval_modifier(request_retention) {
      if (request_retention <= 0 || request_retention > 1) {
        throw new Error("Requested retention rate should be in the range (0,1]");
      }
      const { decay, factor } = computeDecayFactor(this.param.w);
      return +((Math.pow(request_retention, 1 / decay) - 1) / factor).toFixed(8);
    }
    /**
     * Get the parameters of the algorithm.
     */
    get parameters() {
      return this.param;
    }
    /**
     * Set the parameters of the algorithm.
     * @param params Partial<FSRSParameters>
     */
    set parameters(params) {
      this.update_parameters(params);
    }
    params_handler_proxy() {
      const _this = this;
      return {
        set: function(target, prop, value) {
          if (prop === "request_retention" && Number.isFinite(value)) {
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(value)
            );
          } else if (prop === "w") {
            value = migrateParameters(
              value,
              target.relearning_steps.length,
              target.enable_short_term
            );
            _this.forgetting_curve = forgetting_curve.bind(this, value);
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(target.request_retention)
            );
          }
          Reflect.set(target, prop, value);
          return true;
        }
      };
    }
    update_parameters(params) {
      const _params = generatorParameters(params);
      for (const key in _params) {
        const paramKey = key;
        this.param[paramKey] = _params[paramKey];
      }
    }
    /**
       * The formula used is :
       * $$ S_0(G) = w_{G-1}$$
       * $$S_0 = \max \lbrace S_0,0.1\rbrace $$
    
       * @param g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
       * @return Stability (interval when R=90%)
       */
    init_stability(g) {
      return Math.max(this.param.w[g - 1], 0.1);
    }
    /**
     * The formula used is :
     * $$D_0(G) = w_4 - e^{(G-1) \cdot w_5} + 1 $$
     * $$D_0 = \min \lbrace \max \lbrace D_0(G),1 \rbrace,10 \rbrace$$
     * where the $$D_0(1)=w_4$$ when the first rating is good.
     *
     * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return {number} Difficulty $$D \in [1,10]$$
     */
    init_difficulty(g) {
      const d = this.param.w[4] - Math.exp((g - 1) * this.param.w[5]) + 1;
      return +d.toFixed(8);
    }
    /**
     * If fuzzing is disabled or ivl is less than 2.5, it returns the original interval.
     * @param {number} ivl - The interval to be fuzzed.
     * @param {number} elapsed_days t days since the last review
     * @return {number} - The fuzzed interval.
     **/
    apply_fuzz(ivl, elapsed_days) {
      if (!this.param.enable_fuzz || ivl < 2.5) return Math.round(ivl);
      const generator = alea(this._seed);
      const fuzz_factor = generator();
      const { min_ivl, max_ivl } = get_fuzz_range(
        ivl,
        elapsed_days,
        this.param.maximum_interval
      );
      return Math.floor(fuzz_factor * (max_ivl - min_ivl + 1) + min_ivl);
    }
    /**
     *   @see The formula used is : {@link FSRSAlgorithm.calculate_interval_modifier}
     *   @param {number} s - Stability (interval when R=90%)
     *   @param {number} elapsed_days t days since the last review
     */
    next_interval(s, elapsed_days) {
      const newInterval = Math.min(
        Math.max(1, Math.round(s * this.intervalModifier)),
        this.param.maximum_interval
      );
      return this.apply_fuzz(newInterval, elapsed_days);
    }
    /**
     * @see https://github.com/open-spaced-repetition/fsrs4anki/issues/697
     */
    linear_damping(delta_d, old_d) {
      return +(delta_d * (10 - old_d) / 9).toFixed(8);
    }
    /**
     * The formula used is :
     * $$\text{delta}_d = -w_6 \cdot (g - 3)$$
     * $$\text{next}_d = D + \text{linear damping}(\text{delta}_d , D)$$
     * $$D^\prime(D,R) = w_7 \cdot D_0(4) +(1 - w_7) \cdot \text{next}_d$$
     * @param {number} d Difficulty $$D \in [1,10]$$
     * @param {Grade} g Grade (rating at Anki) [1.again,2.hard,3.good,4.easy]
     * @return {number} $$\text{next}_D$$
     */
    next_difficulty(d, g) {
      const delta_d = -this.param.w[6] * (g - 3);
      const next_d = d + this.linear_damping(delta_d, d);
      return clamp(
        this.mean_reversion(this.init_difficulty(Rating.Easy), next_d),
        1,
        10
      );
    }
    /**
     * The formula used is :
     * $$w_7 \cdot \text{init} +(1 - w_7) \cdot \text{current}$$
     * @param {number} init $$w_2 : D_0(3) = w_2 + (R-2) \cdot w_3= w_2$$
     * @param {number} current $$D - w_6 \cdot (R - 2)$$
     * @return {number} difficulty
     */
    mean_reversion(init, current) {
      return +(this.param.w[7] * init + (1 - this.param.w[7]) * current).toFixed(
        8
      );
    }
    /**
     * The formula used is :
     * $$S^\prime_r(D,S,R,G) = S\cdot(e^{w_8}\cdot (11-D)\cdot S^{-w_9}\cdot(e^{w_{10}\cdot(1-R)}-1)\cdot w_{15}(\text{if} G=2) \cdot w_{16}(\text{if} G=4)+1)$$
     * @param {number} d Difficulty D \in [1,10]
     * @param {number} s Stability (interval when R=90%)
     * @param {number} r Retrievability (probability of recall)
     * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
     * @return {number} S^\prime_r new stability after recall
     */
    next_recall_stability(d, s, r, g) {
      const hard_penalty = Rating.Hard === g ? this.param.w[15] : 1;
      const easy_bound = Rating.Easy === g ? this.param.w[16] : 1;
      return +clamp(
        s * (1 + Math.exp(this.param.w[8]) * (11 - d) * Math.pow(s, -this.param.w[9]) * (Math.exp((1 - r) * this.param.w[10]) - 1) * hard_penalty * easy_bound),
        S_MIN,
        36500
      ).toFixed(8);
    }
    /**
     * The formula used is :
     * $$S^\prime_f(D,S,R) = w_{11}\cdot D^{-w_{12}}\cdot ((S+1)^{w_{13}}-1) \cdot e^{w_{14}\cdot(1-R)}$$
     * enable_short_term = true : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, \frac{S}{e^{w_{17} \cdot w_{18}}} \rbrace$$
     * enable_short_term = false : $$S^\prime_f \in \min \lbrace \max \lbrace S^\prime_f,0.01\rbrace, S \rbrace$$
     * @param {number} d Difficulty D \in [1,10]
     * @param {number} s Stability (interval when R=90%)
     * @param {number} r Retrievability (probability of recall)
     * @return {number} S^\prime_f new stability after forgetting
     */
    next_forget_stability(d, s, r) {
      return +clamp(
        this.param.w[11] * Math.pow(d, -this.param.w[12]) * (Math.pow(s + 1, this.param.w[13]) - 1) * Math.exp((1 - r) * this.param.w[14]),
        S_MIN,
        36500
      ).toFixed(8);
    }
    /**
     * The formula used is :
     * $$S^\prime_s(S,G) = S \cdot e^{w_{17} \cdot (G-3+w_{18})}$$
     * @param {number} s Stability (interval when R=90%)
     * @param {Grade} g Grade (Rating[0.again,1.hard,2.good,3.easy])
     */
    next_short_term_stability(s, g) {
      const sinc = Math.pow(s, -this.param.w[19]) * Math.exp(this.param.w[17] * (g - 3 + this.param.w[18]));
      const maskedSinc = g >= 3 ? Math.max(sinc, 1) : sinc;
      return +clamp(s * maskedSinc, S_MIN, 36500).toFixed(8);
    }
    /**
     * Calculates the next state of memory based on the current state, time elapsed, and grade.
     *
     * @param memory_state - The current state of memory, which can be null.
     * @param t - The time elapsed since the last review.
     * @param {Rating} g Grade (Rating[0.Manual,1.Again,2.Hard,3.Good,4.Easy])
     * @returns The next state of memory with updated difficulty and stability.
     */
    next_state(memory_state, t, g) {
      const { difficulty: d, stability: s } = memory_state ?? {
        difficulty: 0,
        stability: 0
      };
      if (t < 0) {
        throw new Error(`Invalid delta_t "${t}"`);
      }
      if (g < 0 || g > 4) {
        throw new Error(`Invalid grade "${g}"`);
      }
      if (d === 0 && s === 0) {
        return {
          difficulty: clamp(this.init_difficulty(g), 1, 10),
          stability: this.init_stability(g)
        };
      }
      if (g === 0) {
        return {
          difficulty: d,
          stability: s
        };
      }
      if (d < 1 || s < S_MIN) {
        throw new Error(
          `Invalid memory state { difficulty: ${d}, stability: ${s} }`
        );
      }
      const r = this.forgetting_curve(t, s);
      const s_after_success = this.next_recall_stability(d, s, r, g);
      const s_after_fail = this.next_forget_stability(d, s, r);
      const s_after_short_term = this.next_short_term_stability(s, g);
      let new_s = s_after_success;
      if (g === 1) {
        let [w_17, w_18] = [0, 0];
        if (this.param.enable_short_term) {
          w_17 = this.param.w[17];
          w_18 = this.param.w[18];
        }
        const next_s_min = s / Math.exp(w_17 * w_18);
        new_s = clamp(+next_s_min.toFixed(8), S_MIN, s_after_fail);
      }
      if (t === 0 && this.param.enable_short_term) {
        new_s = s_after_short_term;
      }
      const new_d = this.next_difficulty(d, g);
      return { difficulty: new_d, stability: new_s };
    }
  };
  var BasicScheduler = class extends AbstractScheduler {
    constructor(card, now, algorithm, strategies) {
      super(card, now, algorithm, strategies);
      __publicField(this, "learningStepsStrategy");
      let learningStepStrategy = BasicLearningStepsStrategy;
      if (this.strategies) {
        const custom_strategy = this.strategies.get(StrategyMode.LEARNING_STEPS);
        if (custom_strategy) {
          learningStepStrategy = custom_strategy;
        }
      }
      this.learningStepsStrategy = learningStepStrategy;
    }
    getLearningInfo(card, grade) {
      const parameters = this.algorithm.parameters;
      card.learning_steps = card.learning_steps || 0;
      const steps_strategy = this.learningStepsStrategy(
        parameters,
        card.state,
        // In the original learning steps setup (Again = 5m, Hard = 10m, Good = FSRS),
        // not adding 1 can cause slight variations in the memory state’s ds.
        this.current.state === State.Learning && grade !== Rating.Again && grade !== Rating.Hard ? card.learning_steps + 1 : card.learning_steps
      );
      const scheduled_minutes = Math.max(
        0,
        steps_strategy[grade]?.scheduled_minutes ?? 0
      );
      const next_steps = Math.max(0, steps_strategy[grade]?.next_step ?? 0);
      return {
        scheduled_minutes,
        next_steps
      };
    }
    /**
     * @description This function applies the learning steps based on the current card's state and grade.
     */
    applyLearningSteps(nextCard, grade, to_state) {
      const { scheduled_minutes, next_steps } = this.getLearningInfo(
        this.current,
        grade
      );
      if (scheduled_minutes > 0 && scheduled_minutes < 1440) {
        nextCard.learning_steps = next_steps;
        nextCard.scheduled_days = 0;
        nextCard.state = to_state;
        nextCard.due = date_scheduler(
          this.review_time,
          Math.round(scheduled_minutes),
          false
          /** true:days false: minute */
        );
      } else {
        nextCard.state = State.Review;
        if (scheduled_minutes >= 1440) {
          nextCard.learning_steps = next_steps;
          nextCard.due = date_scheduler(
            this.review_time,
            Math.round(scheduled_minutes),
            false
            /** true:days false: minute */
          );
          nextCard.scheduled_days = Math.floor(scheduled_minutes / 1440);
        } else {
          nextCard.learning_steps = 0;
          const interval = this.algorithm.next_interval(
            nextCard.stability,
            this.elapsed_days
          );
          nextCard.scheduled_days = interval;
          nextCard.due = date_scheduler(this.review_time, interval, true);
        }
      }
    }
    newState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const next = TypeConvert.card(this.current);
      next.difficulty = clamp(this.algorithm.init_difficulty(grade), 1, 10);
      next.stability = this.algorithm.init_stability(grade);
      this.applyLearningSteps(next, grade, State.Learning);
      const item = {
        card: next,
        log: this.buildLog(grade)
      };
      this.next.set(grade, item);
      return item;
    }
    learningState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const { state, difficulty, stability } = this.last;
      const next = TypeConvert.card(this.current);
      next.difficulty = this.algorithm.next_difficulty(difficulty, grade);
      next.stability = this.algorithm.next_short_term_stability(stability, grade);
      this.applyLearningSteps(
        next,
        grade,
        state
        /** Learning or Relearning */
      );
      const item = {
        card: next,
        log: this.buildLog(grade)
      };
      this.next.set(grade, item);
      return item;
    }
    reviewState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const interval = this.elapsed_days;
      const { difficulty, stability } = this.last;
      const retrievability = this.algorithm.forgetting_curve(interval, stability);
      const next_again = TypeConvert.card(this.current);
      const next_hard = TypeConvert.card(this.current);
      const next_good = TypeConvert.card(this.current);
      const next_easy = TypeConvert.card(this.current);
      this.next_ds(
        next_again,
        next_hard,
        next_good,
        next_easy,
        difficulty,
        stability,
        retrievability
      );
      this.next_interval(next_hard, next_good, next_easy, interval);
      this.next_state(next_hard, next_good, next_easy);
      this.applyLearningSteps(next_again, Rating.Again, State.Relearning);
      next_again.lapses += 1;
      const item_again = {
        card: next_again,
        log: this.buildLog(Rating.Again)
      };
      const item_hard = {
        card: next_hard,
        log: super.buildLog(Rating.Hard)
      };
      const item_good = {
        card: next_good,
        log: super.buildLog(Rating.Good)
      };
      const item_easy = {
        card: next_easy,
        log: super.buildLog(Rating.Easy)
      };
      this.next.set(Rating.Again, item_again);
      this.next.set(Rating.Hard, item_hard);
      this.next.set(Rating.Good, item_good);
      this.next.set(Rating.Easy, item_easy);
      return this.next.get(grade);
    }
    /**
     * Review next_ds
     */
    next_ds(next_again, next_hard, next_good, next_easy, difficulty, stability, retrievability) {
      next_again.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Again
      );
      const nextSMin = stability / Math.exp(
        this.algorithm.parameters.w[17] * this.algorithm.parameters.w[18]
      );
      const s_after_fail = this.algorithm.next_forget_stability(
        difficulty,
        stability,
        retrievability
      );
      next_again.stability = clamp(+nextSMin.toFixed(8), S_MIN, s_after_fail);
      next_hard.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Hard
      );
      next_hard.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Hard
      );
      next_good.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Good
      );
      next_good.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Good
      );
      next_easy.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Easy
      );
      next_easy.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Easy
      );
    }
    /**
     * Review next_interval
     */
    next_interval(next_hard, next_good, next_easy, interval) {
      let hard_interval, good_interval;
      hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
      good_interval = this.algorithm.next_interval(next_good.stability, interval);
      hard_interval = Math.min(hard_interval, good_interval);
      good_interval = Math.max(good_interval, hard_interval + 1);
      const easy_interval = Math.max(
        this.algorithm.next_interval(next_easy.stability, interval),
        good_interval + 1
      );
      next_hard.scheduled_days = hard_interval;
      next_hard.due = date_scheduler(this.review_time, hard_interval, true);
      next_good.scheduled_days = good_interval;
      next_good.due = date_scheduler(this.review_time, good_interval, true);
      next_easy.scheduled_days = easy_interval;
      next_easy.due = date_scheduler(this.review_time, easy_interval, true);
    }
    /**
     * Review next_state
     */
    next_state(next_hard, next_good, next_easy) {
      next_hard.state = State.Review;
      next_hard.learning_steps = 0;
      next_good.state = State.Review;
      next_good.learning_steps = 0;
      next_easy.state = State.Review;
      next_easy.learning_steps = 0;
    }
  };
  var LongTermScheduler = class extends AbstractScheduler {
    newState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      this.current.scheduled_days = 0;
      this.current.elapsed_days = 0;
      const next_again = TypeConvert.card(this.current);
      const next_hard = TypeConvert.card(this.current);
      const next_good = TypeConvert.card(this.current);
      const next_easy = TypeConvert.card(this.current);
      this.init_ds(next_again, next_hard, next_good, next_easy);
      const first_interval = 0;
      this.next_interval(
        next_again,
        next_hard,
        next_good,
        next_easy,
        first_interval
      );
      this.next_state(next_again, next_hard, next_good, next_easy);
      this.update_next(next_again, next_hard, next_good, next_easy);
      return this.next.get(grade);
    }
    init_ds(next_again, next_hard, next_good, next_easy) {
      next_again.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Again),
        1,
        10
      );
      next_again.stability = this.algorithm.init_stability(Rating.Again);
      next_hard.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Hard),
        1,
        10
      );
      next_hard.stability = this.algorithm.init_stability(Rating.Hard);
      next_good.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Good),
        1,
        10
      );
      next_good.stability = this.algorithm.init_stability(Rating.Good);
      next_easy.difficulty = clamp(
        this.algorithm.init_difficulty(Rating.Easy),
        1,
        10
      );
      next_easy.stability = this.algorithm.init_stability(Rating.Easy);
    }
    /**
     * @see https://github.com/open-spaced-repetition/ts-fsrs/issues/98#issuecomment-2241923194
     */
    learningState(grade) {
      return this.reviewState(grade);
    }
    reviewState(grade) {
      const exist = this.next.get(grade);
      if (exist) {
        return exist;
      }
      const interval = this.elapsed_days;
      const { difficulty, stability } = this.last;
      const retrievability = this.algorithm.forgetting_curve(interval, stability);
      const next_again = TypeConvert.card(this.current);
      const next_hard = TypeConvert.card(this.current);
      const next_good = TypeConvert.card(this.current);
      const next_easy = TypeConvert.card(this.current);
      this.next_ds(
        next_again,
        next_hard,
        next_good,
        next_easy,
        difficulty,
        stability,
        retrievability
      );
      this.next_interval(next_again, next_hard, next_good, next_easy, interval);
      this.next_state(next_again, next_hard, next_good, next_easy);
      next_again.lapses += 1;
      this.update_next(next_again, next_hard, next_good, next_easy);
      return this.next.get(grade);
    }
    /**
     * Review next_ds
     */
    next_ds(next_again, next_hard, next_good, next_easy, difficulty, stability, retrievability) {
      next_again.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Again
      );
      const s_after_fail = this.algorithm.next_forget_stability(
        difficulty,
        stability,
        retrievability
      );
      next_again.stability = clamp(stability, S_MIN, s_after_fail);
      next_hard.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Hard
      );
      next_hard.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Hard
      );
      next_good.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Good
      );
      next_good.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Good
      );
      next_easy.difficulty = this.algorithm.next_difficulty(
        difficulty,
        Rating.Easy
      );
      next_easy.stability = this.algorithm.next_recall_stability(
        difficulty,
        stability,
        retrievability,
        Rating.Easy
      );
    }
    /**
     * Review/New next_interval
     */
    next_interval(next_again, next_hard, next_good, next_easy, interval) {
      let again_interval, hard_interval, good_interval, easy_interval;
      again_interval = this.algorithm.next_interval(
        next_again.stability,
        interval
      );
      hard_interval = this.algorithm.next_interval(next_hard.stability, interval);
      good_interval = this.algorithm.next_interval(next_good.stability, interval);
      easy_interval = this.algorithm.next_interval(next_easy.stability, interval);
      again_interval = Math.min(again_interval, hard_interval);
      hard_interval = Math.max(hard_interval, again_interval + 1);
      good_interval = Math.max(good_interval, hard_interval + 1);
      easy_interval = Math.max(easy_interval, good_interval + 1);
      next_again.scheduled_days = again_interval;
      next_again.due = date_scheduler(this.review_time, again_interval, true);
      next_hard.scheduled_days = hard_interval;
      next_hard.due = date_scheduler(this.review_time, hard_interval, true);
      next_good.scheduled_days = good_interval;
      next_good.due = date_scheduler(this.review_time, good_interval, true);
      next_easy.scheduled_days = easy_interval;
      next_easy.due = date_scheduler(this.review_time, easy_interval, true);
    }
    /**
     * Review/New next_state
     */
    next_state(next_again, next_hard, next_good, next_easy) {
      next_again.state = State.Review;
      next_again.learning_steps = 0;
      next_hard.state = State.Review;
      next_hard.learning_steps = 0;
      next_good.state = State.Review;
      next_good.learning_steps = 0;
      next_easy.state = State.Review;
      next_easy.learning_steps = 0;
    }
    update_next(next_again, next_hard, next_good, next_easy) {
      const item_again = {
        card: next_again,
        log: this.buildLog(Rating.Again)
      };
      const item_hard = {
        card: next_hard,
        log: super.buildLog(Rating.Hard)
      };
      const item_good = {
        card: next_good,
        log: super.buildLog(Rating.Good)
      };
      const item_easy = {
        card: next_easy,
        log: super.buildLog(Rating.Easy)
      };
      this.next.set(Rating.Again, item_again);
      this.next.set(Rating.Hard, item_hard);
      this.next.set(Rating.Good, item_good);
      this.next.set(Rating.Easy, item_easy);
    }
  };
  var Reschedule = class {
    /**
     * Creates an instance of the `Reschedule` class.
     * @param fsrs - An instance of the FSRS class used for scheduling.
     */
    constructor(fsrs2) {
      __publicField(this, "fsrs");
      this.fsrs = fsrs2;
    }
    /**
     * Replays a review for a card and determines the next review date based on the given rating.
     * @param card - The card being reviewed.
     * @param reviewed - The date the card was reviewed.
     * @param rating - The grade given to the card during the review.
     * @returns A `RecordLogItem` containing the updated card and review log.
     */
    replay(card, reviewed, rating) {
      return this.fsrs.next(card, reviewed, rating);
    }
    /**
     * Processes a manual review for a card, allowing for custom state, stability, difficulty, and due date.
     * @param card - The card being reviewed.
     * @param state - The state of the card after the review.
     * @param reviewed - The date the card was reviewed.
     * @param elapsed_days - The number of days since the last review.
     * @param stability - (Optional) The stability of the card.
     * @param difficulty - (Optional) The difficulty of the card.
     * @param due - (Optional) The due date for the next review.
     * @returns A `RecordLogItem` containing the updated card and review log.
     * @throws Will throw an error if the state or due date is not provided when required.
     */
    handleManualRating(card, state, reviewed, elapsed_days, stability, difficulty, due) {
      if (typeof state === "undefined") {
        throw new Error("reschedule: state is required for manual rating");
      }
      let log;
      let next_card;
      if (state === State.New) {
        log = {
          rating: Rating.Manual,
          state,
          due: due ?? reviewed,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days,
          last_elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          learning_steps: card.learning_steps,
          review: reviewed
        };
        next_card = createEmptyCard(reviewed);
        next_card.last_review = reviewed;
      } else {
        if (typeof due === "undefined") {
          throw new Error("reschedule: due is required for manual rating");
        }
        const scheduled_days = date_diff(due, reviewed, "days");
        log = {
          rating: Rating.Manual,
          state: card.state,
          due: card.last_review || card.due,
          stability: card.stability,
          difficulty: card.difficulty,
          elapsed_days,
          last_elapsed_days: card.elapsed_days,
          scheduled_days: card.scheduled_days,
          learning_steps: card.learning_steps,
          review: reviewed
        };
        next_card = {
          ...card,
          state,
          due,
          last_review: reviewed,
          stability: stability || card.stability,
          difficulty: difficulty || card.difficulty,
          elapsed_days,
          scheduled_days,
          reps: card.reps + 1
        };
      }
      return { card: next_card, log };
    }
    /**
     * Reschedules a card based on its review history.
     *
     * @param current_card - The card to be rescheduled.
     * @param reviews - An array of review history objects.
     * @returns An array of record log items representing the rescheduling process.
     */
    reschedule(current_card, reviews) {
      const collections = [];
      let cur_card = createEmptyCard(current_card.due);
      for (const review of reviews) {
        let item;
        review.review = TypeConvert.time(review.review);
        if (review.rating === Rating.Manual) {
          let interval = 0;
          if (cur_card.state !== State.New && cur_card.last_review) {
            interval = date_diff(review.review, cur_card.last_review, "days");
          }
          item = this.handleManualRating(
            cur_card,
            review.state,
            review.review,
            interval,
            review.stability,
            review.difficulty,
            review.due ? TypeConvert.time(review.due) : void 0
          );
        } else {
          item = this.replay(cur_card, review.review, review.rating);
        }
        collections.push(item);
        cur_card = item.card;
      }
      return collections;
    }
    calculateManualRecord(current_card, now, record_log_item, update_memory) {
      if (!record_log_item) {
        return null;
      }
      const { card: reschedule_card, log } = record_log_item;
      const cur_card = TypeConvert.card(current_card);
      if (cur_card.due.getTime() === reschedule_card.due.getTime()) {
        return null;
      }
      cur_card.scheduled_days = date_diff(
        reschedule_card.due,
        cur_card.due,
        "days"
      );
      return this.handleManualRating(
        cur_card,
        reschedule_card.state,
        TypeConvert.time(now),
        log.elapsed_days,
        update_memory ? reschedule_card.stability : void 0,
        update_memory ? reschedule_card.difficulty : void 0,
        reschedule_card.due
      );
    }
  };
  var FSRS = class extends FSRSAlgorithm {
    constructor(param) {
      super(param);
      __publicField(this, "strategyHandler", /* @__PURE__ */ new Map());
      __publicField(this, "Scheduler");
      const { enable_short_term } = this.parameters;
      this.Scheduler = enable_short_term ? BasicScheduler : LongTermScheduler;
    }
    params_handler_proxy() {
      const _this = this;
      return {
        set: function(target, prop, value) {
          if (prop === "request_retention" && Number.isFinite(value)) {
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(value)
            );
          } else if (prop === "enable_short_term") {
            _this.Scheduler = value === true ? BasicScheduler : LongTermScheduler;
          } else if (prop === "w") {
            value = migrateParameters(
              value,
              target.relearning_steps.length,
              target.enable_short_term
            );
            _this.forgetting_curve = forgetting_curve.bind(this, value);
            _this.intervalModifier = _this.calculate_interval_modifier(
              Number(target.request_retention)
            );
          }
          Reflect.set(target, prop, value);
          return true;
        }
      };
    }
    useStrategy(mode, handler) {
      this.strategyHandler.set(mode, handler);
      return this;
    }
    clearStrategy(mode) {
      if (mode) {
        this.strategyHandler.delete(mode);
      } else {
        this.strategyHandler.clear();
      }
      return this;
    }
    getScheduler(card, now) {
      const schedulerStrategy = this.strategyHandler.get(
        StrategyMode.SCHEDULER
      );
      const Scheduler = schedulerStrategy || this.Scheduler;
      const instance = new Scheduler(card, now, this, this.strategyHandler);
      return instance;
    }
    /**
     * Display the collection of cards and logs for the four scenarios after scheduling the card at the current time.
     * @param card Card to be processed
     * @param now Current time or scheduled time
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const card: Card = createEmptyCard(new Date());
     * const f = fsrs();
     * const recordLog = f.repeat(card, new Date());
     * ```
     * @example
     * ```typescript
     * interface RevLogUnchecked
     *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
     *   cid: string;
     *   due: Date | number;
     *   state: StateType;
     *   review: Date | number;
     *   rating: RatingType;
     * }
     *
     * interface RepeatRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked;
     * }
     *
     * function repeatAfterHandler(recordLog: RecordLog) {
     *     const record: { [key in Grade]: RepeatRecordLog } = {} as {
     *       [key in Grade]: RepeatRecordLog;
     *     };
     *     for (const grade of Grades) {
     *       record[grade] = {
     *         card: {
     *           ...(recordLog[grade].card as Card & { cid: string }),
     *           due: recordLog[grade].card.due.getTime(),
     *           state: State[recordLog[grade].card.state] as StateType,
     *           last_review: recordLog[grade].card.last_review
     *             ? recordLog[grade].card.last_review!.getTime()
     *             : null,
     *         },
     *         log: {
     *           ...recordLog[grade].log,
     *           cid: (recordLog[grade].card as Card & { cid: string }).cid,
     *           due: recordLog[grade].log.due.getTime(),
     *           review: recordLog[grade].log.review.getTime(),
     *           state: State[recordLog[grade].log.state] as StateType,
     *           rating: Rating[recordLog[grade].log.rating] as RatingType,
     *         },
     *       };
     *     }
     *     return record;
     * }
     * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
     * const f = fsrs();
     * const recordLog = f.repeat(card, new Date(), repeatAfterHandler);
     * ```
     */
    repeat(card, now, afterHandler) {
      const instance = this.getScheduler(card, now);
      const recordLog = instance.preview();
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(recordLog);
      } else {
        return recordLog;
      }
    }
    /**
     * Display the collection of cards and logs for the card scheduled at the current time, after applying a specific grade rating.
     * @param card Card to be processed
     * @param now Current time or scheduled time
     * @param grade Rating of the review (Again, Hard, Good, Easy)
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const card: Card = createEmptyCard(new Date());
     * const f = fsrs();
     * const recordLogItem = f.next(card, new Date(), Rating.Again);
     * ```
     * @example
     * ```typescript
     * interface RevLogUnchecked
     *   extends Omit<ReviewLog, "due" | "review" | "state" | "rating"> {
     *   cid: string;
     *   due: Date | number;
     *   state: StateType;
     *   review: Date | number;
     *   rating: RatingType;
     * }
     *
     * interface NextRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked;
     * }
     *
    function nextAfterHandler(recordLogItem: RecordLogItem) {
      const recordItem = {
        card: {
          ...(recordLogItem.card as Card & { cid: string }),
          due: recordLogItem.card.due.getTime(),
          state: State[recordLogItem.card.state] as StateType,
          last_review: recordLogItem.card.last_review
            ? recordLogItem.card.last_review!.getTime()
            : null,
        },
        log: {
          ...recordLogItem.log,
          cid: (recordLogItem.card as Card & { cid: string }).cid,
          due: recordLogItem.log.due.getTime(),
          review: recordLogItem.log.review.getTime(),
          state: State[recordLogItem.log.state] as StateType,
          rating: Rating[recordLogItem.log.rating] as RatingType,
        },
      };
      return recordItem
    }
     * const card: Card = createEmptyCard(new Date(), cardAfterHandler); //see method:  createEmptyCard
     * const f = fsrs();
     * const recordLogItem = f.repeat(card, new Date(), Rating.Again, nextAfterHandler);
     * ```
     */
    next(card, now, grade, afterHandler) {
      const instance = this.getScheduler(card, now);
      const g = TypeConvert.rating(grade);
      if (g === Rating.Manual) {
        throw new Error("Cannot review a manual rating");
      }
      const recordLogItem = instance.review(g);
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(recordLogItem);
      } else {
        return recordLogItem;
      }
    }
    /**
     * Get the retrievability of the card
     * @param card  Card to be processed
     * @param now  Current time or scheduled time
     * @param format  default:true , Convert the result to another type. (Optional)
     * @returns  The retrievability of the card,if format is true, the result is a string, otherwise it is a number
     */
    get_retrievability(card, now, format = true) {
      const processedCard = TypeConvert.card(card);
      now = now ? TypeConvert.time(now) : /* @__PURE__ */ new Date();
      const t = processedCard.state !== State.New ? Math.max(date_diff(now, processedCard.last_review, "days"), 0) : 0;
      const r = processedCard.state !== State.New ? this.forgetting_curve(t, +processedCard.stability.toFixed(8)) : 0;
      return format ? `${(r * 100).toFixed(2)}%` : r;
    }
    /**
     *
     * @param card Card to be processed
     * @param log last review log
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now);
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now);
     * const { card, log } = repeatFormAfterHandler[Rating.Hard];
     * const rollbackFromAfterHandler = f.rollback(card, log);
     * ```
     *
     * @example
     * ```typescript
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler);  //see method: createEmptyCard
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
     * const { card, log } = repeatFormAfterHandler[Rating.Hard];
     * const rollbackFromAfterHandler = f.rollback(card, log, cardAfterHandler);
     * ```
     */
    rollback(card, log, afterHandler) {
      const processedCard = TypeConvert.card(card);
      const processedLog = TypeConvert.review_log(log);
      if (processedLog.rating === Rating.Manual) {
        throw new Error("Cannot rollback a manual rating");
      }
      let last_due;
      let last_review;
      let last_lapses;
      switch (processedLog.state) {
        case State.New:
          last_due = processedLog.due;
          last_review = void 0;
          last_lapses = 0;
          break;
        case State.Learning:
        case State.Relearning:
        case State.Review:
          last_due = processedLog.review;
          last_review = processedLog.due;
          last_lapses = processedCard.lapses - (processedLog.rating === Rating.Again && processedLog.state === State.Review ? 1 : 0);
          break;
      }
      const prevCard = {
        ...processedCard,
        due: last_due,
        stability: processedLog.stability,
        difficulty: processedLog.difficulty,
        elapsed_days: processedLog.last_elapsed_days,
        scheduled_days: processedLog.scheduled_days,
        reps: Math.max(0, processedCard.reps - 1),
        lapses: Math.max(0, last_lapses),
        learning_steps: processedLog.learning_steps,
        state: processedLog.state,
        last_review
      };
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(prevCard);
      } else {
        return prevCard;
      }
    }
    /**
     *
     * @param card Card to be processed
     * @param now Current time or scheduled time
     * @param reset_count Should the review count information(reps,lapses) be reset. (Optional)
     * @param afterHandler Convert the result to another type. (Optional)
     * @example
     * ```typescript
     * const now = new Date();
     * const f = fsrs();
     * const emptyCard = createEmptyCard(now);
     * const scheduling_cards = f.repeat(emptyCard, now);
     * const { card, log } = scheduling_cards[Rating.Hard];
     * const forgetCard = f.forget(card, new Date(), true);
     * ```
     *
     * @example
     * ```typescript
     * interface RepeatRecordLog {
     *   card: CardUnChecked; //see method: createEmptyCard
     *   log: RevLogUnchecked; //see method: fsrs.repeat()
     * }
     *
     * function forgetAfterHandler(recordLogItem: RecordLogItem): RepeatRecordLog {
     *     return {
     *       card: {
     *         ...(recordLogItem.card as Card & { cid: string }),
     *         due: recordLogItem.card.due.getTime(),
     *         state: State[recordLogItem.card.state] as StateType,
     *         last_review: recordLogItem.card.last_review
     *           ? recordLogItem.card.last_review!.getTime()
     *           : null,
     *       },
     *       log: {
     *         ...recordLogItem.log,
     *         cid: (recordLogItem.card as Card & { cid: string }).cid,
     *         due: recordLogItem.log.due.getTime(),
     *         review: recordLogItem.log.review.getTime(),
     *         state: State[recordLogItem.log.state] as StateType,
     *         rating: Rating[recordLogItem.log.rating] as RatingType,
     *       },
     *     };
     * }
     * const now = new Date();
     * const f = fsrs();
     * const emptyCardFormAfterHandler = createEmptyCard(now, cardAfterHandler); //see method:  createEmptyCard
     * const repeatFormAfterHandler = f.repeat(emptyCardFormAfterHandler, now, repeatAfterHandler); //see method: fsrs.repeat()
     * const { card } = repeatFormAfterHandler[Rating.Hard];
     * const forgetFromAfterHandler = f.forget(card, date_scheduler(now, 1, true), false, forgetAfterHandler);
     * ```
     */
    forget(card, now, reset_count = false, afterHandler) {
      const processedCard = TypeConvert.card(card);
      now = TypeConvert.time(now);
      const scheduled_days = processedCard.state === State.New ? 0 : date_diff(now, processedCard.due, "days");
      const forget_log = {
        rating: Rating.Manual,
        state: processedCard.state,
        due: processedCard.due,
        stability: processedCard.stability,
        difficulty: processedCard.difficulty,
        elapsed_days: 0,
        last_elapsed_days: processedCard.elapsed_days,
        scheduled_days,
        learning_steps: processedCard.learning_steps,
        review: now
      };
      const forget_card = {
        ...processedCard,
        due: now,
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: reset_count ? 0 : processedCard.reps,
        lapses: reset_count ? 0 : processedCard.lapses,
        learning_steps: 0,
        state: State.New,
        last_review: processedCard.last_review
      };
      const recordLogItem = { card: forget_card, log: forget_log };
      if (afterHandler && typeof afterHandler === "function") {
        return afterHandler(recordLogItem);
      } else {
        return recordLogItem;
      }
    }
    /**
     * Reschedules the current card and returns the rescheduled collections and reschedule item.
     *
     * @template T - The type of the record log item.
     * @param {CardInput | Card} current_card - The current card to be rescheduled.
     * @param {Array<FSRSHistory>} reviews - The array of FSRSHistory objects representing the reviews.
     * @param {Partial<RescheduleOptions<T>>} options - The optional reschedule options.
     * @returns {IReschedule<T>} - The rescheduled collections and reschedule item.
     *
     * @example
     * ```typescript
     * const f = fsrs()
     * const grades: Grade[] = [Rating.Good, Rating.Good, Rating.Good, Rating.Good]
     * const reviews_at = [
     *   new Date(2024, 8, 13),
     *   new Date(2024, 8, 13),
     *   new Date(2024, 8, 17),
     *   new Date(2024, 8, 28),
     * ]
     *
     * const reviews: FSRSHistory[] = []
     * for (let i = 0; i < grades.length; i++) {
     *   reviews.push({
     *     rating: grades[i],
     *     review: reviews_at[i],
     *   })
     * }
     *
     * const results_short = scheduler.reschedule(
     *   createEmptyCard(),
     *   reviews,
     *   {
     *     skipManual: false,
     *   }
     * )
     * console.log(results_short)
     * ```
     */
    reschedule(current_card, reviews = [], options = {}) {
      const {
        recordLogHandler,
        reviewsOrderBy,
        skipManual = true,
        now = /* @__PURE__ */ new Date(),
        update_memory_state: updateMemoryState = false
      } = options;
      if (reviewsOrderBy && typeof reviewsOrderBy === "function") {
        reviews.sort(reviewsOrderBy);
      }
      if (skipManual) {
        reviews = reviews.filter((review) => review.rating !== Rating.Manual);
      }
      const rescheduleSvc = new Reschedule(this);
      const collections = rescheduleSvc.reschedule(
        options.first_card || createEmptyCard(),
        reviews
      );
      const len = collections.length;
      const cur_card = TypeConvert.card(current_card);
      const manual_item = rescheduleSvc.calculateManualRecord(
        cur_card,
        now,
        len ? collections[len - 1] : void 0,
        updateMemoryState
      );
      if (recordLogHandler && typeof recordLogHandler === "function") {
        return {
          collections: collections.map(recordLogHandler),
          reschedule_item: manual_item ? recordLogHandler(manual_item) : null
        };
      }
      return {
        collections,
        reschedule_item: manual_item
      };
    }
  };
  var fsrs = (params) => {
    return new FSRS(params || {});
  };

  // obsidian/srs/core.js
  var SCHEDULER_VERSION = "ts-fsrs@5.2.3/FSRS-6";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var DEVICE = /^(?:anki|computer|android|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
  function validateOptions(options) {
    if (!options || options.algorithm !== "FSRS-6" || options.enable_fuzz !== false || !Number.isFinite(options.desired_retention) || options.desired_retention <= 0 || options.desired_retention >= 1 || !Number.isInteger(options.maximum_interval) || options.maximum_interval < 1 || options.maximum_interval > 36500 || !Number.isInteger(options.new_cards_per_day) || options.new_cards_per_day < 0) throw Error("Unsupported scheduler configuration");
  }
  function scheduler(options) {
    validateOptions(options);
    return fsrs({ request_retention: options.desired_retention, maximum_interval: options.maximum_interval, enable_fuzz: false });
  }
  function serialize(state) {
    const result = { ...state, due: state.due.getTime() };
    if (state.last_review) result.last_review = state.last_review.getTime();
    return result;
  }
  function hydrate(state) {
    const result = { ...state, due: new Date(state.due) };
    if (state.last_review !== void 0) result.last_review = new Date(state.last_review);
    return result;
  }
  function initialState(card, engine, now = Date.now()) {
    let state = createEmptyCard(new Date(now));
    if (card.queue === 0) return serialize(state);
    let count = 0;
    for (const event of [...card.history].sort((a, b) => a.review_time_ms - b.review_time_ms || a.id.localeCompare(b.id))) {
      if (![0, 1, 2, 3].includes(event.review_type) || ![1, 2, 3, 4].includes(event.rating)) continue;
      state = engine.next(state, new Date(event.review_time_ms), event.rating).card;
      count++;
    }
    if (!count || !Number.isFinite(card.due_ms)) throw Error(`Cannot initialize card ${card.id}: missing review history or due date`);
    state.due = new Date(card.due_ms);
    state.state = card.card_type === 3 ? State.Relearning : card.queue === 2 ? State.Review : State.Learning;
    return serialize(state);
  }
  function validateState(state) {
    if (!state || ![0, 1, 2, 3].includes(state.state)) throw Error("Invalid scheduler state");
    for (const key of ["due", "stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "learning_steps"]) {
      if (!Number.isFinite(state[key]) || key !== "due" && state[key] < 0) throw Error(`Invalid state field ${key}`);
    }
    if (state.last_review !== void 0 && !Number.isFinite(state.last_review)) throw Error("Invalid last_review");
  }
  function validateEvent(event, importId) {
    if (event?.format_version === 2 && ["historical_review", "scheduling_baseline"].includes(event.kind)) {
      if (typeof event.id !== "string" || !Number.isSafeInteger(event.review_time_ms) || !DEVICE.test(event.device_id)) throw Error("Invalid imported event");
      if (event.kind === "historical_review") {
        if (event.id !== `anki:${event.collection_key}:${event.anki_revlog_id}` || event.state !== undefined || !event.original_review) throw Error("Invalid historical observation");
      } else {
        if (typeof event.import_id !== "string" || event.id !== `baseline:${event.import_id}:${event.card_id}`) throw Error("Invalid scheduling baseline");
        if (event.state !== null) validateState(event.state);
      }
      return event;
    }
    if (event?.format_version === 2 && event.kind !== "answer") throw Error("Unknown event kind");
    if (!event || ![1, 2].includes(event.format_version) || !UUID.test(event.id) || !DEVICE.test(event.device_id) || (typeof event.card_id !== "string" || !event.card_id) || event.import_id !== importId || ![SCHEDULER_VERSION, "ts-fsrs@5.2.3/FSRS-6"].includes(event.scheduler_version) || ![1, 2, 3, 4].includes(event.rating) || !Number.isSafeInteger(event.review_time_ms) || event.review_time_ms < 0 || !Number.isFinite(event.duration_ms) || event.duration_ms < 0 || typeof event.was_new !== "boolean" || typeof event.parent !== "string" || !event.scheduler_config || event.scheduler_config.algorithm !== "FSRS-6") throw Error("Invalid or incompatible review event");
    validateState(event.state);
    if (!UUID.test(event.parent) && event.parent !== `import:${importId}:${event.card_id}`) throw Error("Invalid parent state reference");
    validateOptions(event.scheduler_config);
    if (event.state.last_review !== event.review_time_ms) throw Error("Review timestamp and state disagree");
    return event;
  }
  function makeEvent({ card, current, rating, now, duration, deviceId, eventId, manifest, engine }) {
    if (![1, 2, 3, 4].includes(rating)) throw Error("Invalid rating");
    if (current.state.last_review !== void 0 && now < current.state.last_review) throw Error("Device clock precedes the last review");
    const state = engine.next(hydrate(current.state), new Date(now), rating).card;
    const event = {
      format_version: 1,
      id: eventId,
      device_id: deviceId,
      card_id: card.id,
      import_id: manifest.import_id,
      parent: current.parent,
      review_time_ms: now,
      duration_ms: Math.max(0, duration),
      rating,
      was_new: current.state.state === State.New,
      scheduler_version: SCHEDULER_VERSION,
      scheduler_config: manifest.scheduler,
      state: serialize(state)
    };
    return validateEvent(event, manifest.import_id);
  }
  function renderTemplate(template, fields) {
    const token = /{{([#/^]?)([A-Za-z_][A-Za-z_0-9]*)}}/g;
    const stack = [{ visible: true, name: null }];
    let output = "", offset = 0;
    for (const match of template.matchAll(token)) {
      if (stack.at(-1).visible) output += template.slice(offset, match.index);
      const [, marker, key] = match;
      if (!Object.hasOwn(fields, key)) throw Error(`Unknown template field ${key}`);
      if (marker === "#" || marker === "^") {
        const present = String(fields[key] ?? "").trim() !== "";
        stack.push({ name: key, visible: stack.at(-1).visible && (marker === "#" ? present : !present) });
      } else if (marker === "/") {
        if (stack.length === 1 || stack.pop().name !== key) throw Error("Unbalanced template");
      } else if (stack.at(-1).visible) output += fields[key] ?? "";
      offset = match.index + match[0].length;
    }
    if (stack.length !== 1 || /{{|}}/.test(template.replace(token, ""))) throw Error("Unsupported template syntax");
    output += template.slice(offset);
    return output;
  }
  function parseCSV(input2) {
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    input2 = input2.replace(/^\uFEFF/, "");
    const pushField = () => {
      row.push(field);
      field = "";
      closed = false;
    };
    const pushRow = () => {
      pushField();
      rows.push(row);
      row = [];
    };
    for (let i = 0; i < input2.length; i++) {
      const ch = input2[i];
      if (quoted) {
        if (ch === '"' && input2[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
          closed = true;
        } else field += ch;
      } else if (ch === ",") pushField();
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && input2[i + 1] === "\n") i++;
        pushRow();
      } else if (ch === '"' && field === "" && !closed) quoted = true;
      else {
        if (closed || ch === '"') throw Error("Malformed CSV quoting");
        field += ch;
      }
    }
    if (quoted) throw Error("Unterminated CSV quote");
    if (field || row.length || closed) pushRow();
    const columns = rows.shift();
    if (!columns || new Set(columns).size !== columns.length) throw Error("Invalid CSV header");
    return rows.filter((row2) => !(row2.length === 1 && row2[0] === "")).map((row2) => {
      if (row2.length !== columns.length) throw Error("CSV row width differs from header");
      return Object.fromEntries(columns.map((column, index) => [column, row2[index]]));
    });
  }
  function sourceFields(card, rows) {
    const matches = rows instanceof Map ? rows.has(card.note_uid) ? [rows.get(card.note_uid)] : [] : rows.filter((row) => {
      const nid = (row.anki_note_id || "").trim();
      return card.note_uid === (nid ? `anki:${BigInt(nid)}` : `local:${(row.srs_uid || "").trim().toLowerCase()}`);
    });
    if (!matches.length) return null;
    if (matches.length !== 1) throw Error(`Duplicate source identity ${card.note_uid}`);
    return Object.fromEntries(Object.entries(card.source.field_map).map(([target, source]) => [target, matches[0][source] ?? ""]));
  }
  function indexRows(rows) {
    const result = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const nid = (row.anki_note_id || "").trim();
      const uid = nid ? `anki:${BigInt(nid)}` : `local:${(row.srs_uid || "").trim().toLowerCase()}`;
      if (uid === "local:") continue;
      if (result.has(uid)) throw Error(`Duplicate source identity ${uid}`);
      result.set(uid, row);
    }
    return result;
  }
  function configuredCards(cards, config) {
    if (config.format_version !== 1 || !config.groups || typeof config.groups !== "object") throw Error("Unsupported card configuration");
    const templates = /* @__PURE__ */ new Map();
    for (const [group, definition] of Object.entries(config.groups)) {
      if (!Array.isArray(definition.templates)) throw Error(`Invalid templates for ${group}`);
      for (const template of definition.templates) {
        const id = `${group}/${template.key}`;
        if (!/^[a-z][a-z0-9_-]*$/.test(template.key) || templates.has(id) || typeof template.enabled !== "boolean" || !Array.isArray(template.required_fields) || typeof template.front !== "string" || typeof template.back !== "string") throw Error(`Invalid template: ${id}`);
        templates.set(id, template);
      }
    }
    return cards.map((card) => {
      const template = templates.get(`${card.group}/${card.template_key}`);
      if (template && (template.anki_notetype !== card.anki_notetype || template.anki_ordinal !== card.anki_ordinal)) throw Error(`Card binding changed for ${card.group}/${card.template_key}; re-run migration`);
      return { ...card, template, active: true };
    });
  }
  function studyDay(timestamp, timing) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timing.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const day = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
    if (+parts.hour < timing.rollover_hour) day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
  }
  function reviewQueue(cards, states, events, manifest, now, group, introducedCount) {
    const count = introducedCount ?? new Set(events.filter((e) => e.was_new && studyDay(e.review_time_ms, manifest.timing) === studyDay(now, manifest.timing)).map((e) => e.card_id)).size;
    const remaining = Math.max(0, manifest.scheduler.new_cards_per_day - count);
    const eligible = cards.filter((c) => c.active && (!group || c.group === group) && states.has(c.id));
    const due = eligible.filter((c) => states.get(c.id).state.state !== State.New && states.get(c.id).state.due <= now).sort((a, b) => states.get(a.id).state.due - states.get(b.id).state.due || a.id.localeCompare(b.id));
    const fresh = eligible.filter((c) => states.get(c.id).state.state === State.New).sort((a, b) => a.id.localeCompare(b.id)).slice(0, remaining);
    return { cards: [...due, ...fresh], due: due.length, fresh: fresh.length };
  }

  // obsidian/srs/logs.js
  var LOG_LIMIT = 32 * 1024 * 1024;
  var LOG_PATTERN = /^(?:anki|computer|android|[0-9a-f-]{36})-\d{4}-\d{2}(?:-\d{3,})?(?:\.sync-conflict-[^.]+)?\.jsonl$/;
  var encoder = new TextEncoder();
  var bytes = (text) => encoder.encode(text).byteLength;
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  async function hash(text) {
    const data = await crypto.subtle.digest("SHA-256", encoder.encode(text));
    return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function compare(a, b) {
    return a.review_time_ms - b.review_time_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  async function withStoreLock(key, operation) {
    if (globalThis.navigator?.locks) return navigator.locks.request(key, operation);
    const locks = globalThis.__ankobsSRSLocks || (globalThis.__ankobsSRSLocks = /* @__PURE__ */ new Map());
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {
    }).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }
  async function appendReview(store, directory, event, limit = LOG_LIMIT) {
    const line = JSON.stringify(event) + "\n";
    if (bytes(line) > limit) throw Error("Review record exceeds log size limit");
    const month = new Date(event.review_time_ms).toISOString().slice(0, 7);
    let part = 1;
    if (store.list) {
      const stem = `${event.device_id}-${month}`;
      for (const file of await store.list(directory)) {
        const name = file.path.split("/").at(-1);
        if (name === `${stem}.jsonl`) continue;
        const match = name.startsWith(`${stem}-`) && /^-(\d{3,})\.jsonl$/.exec(name.slice(stem.length));
        if (match) part = Math.max(part, Number(match[1]));
      }
    }
    while (true) {
      const suffix = part === 1 ? "" : `-${String(part).padStart(3, "0")}`;
      const path = `${directory}/${event.device_id}-${month}${suffix}.jsonl`;
      const before = await store.read(path);
      if (before !== null && before && !before.endsWith("\n")) throw Error(`Incomplete review log: ${path}`);
      if (before !== null && before.includes(`"id":"${event.id}"`)) {
        const same = before.split("\n").filter(Boolean).map(JSON.parse).find((item) => item.id === event.id);
        if (!same || canonical(same) !== canonical(event)) throw Error("Review event ID collision");
        return path;
      }
      if (bytes(before || "") + bytes(line) > limit) {
        part++;
        continue;
      }
      const expected = (before || "") + line;
      try {
        if (before === null) await store.create(path, line);
        else await store.append(path, line);
      } catch (error) {
        if (await store.read(path) !== expected) throw error;
      }
      if (await store.read(path) !== expected) throw Error(`Review log verification failed: ${path}`);
      return path;
    }
  }
  function request(operation) {
    return new Promise((resolve, reject) => {
      operation.onsuccess = () => resolve(operation.result);
      operation.onerror = () => reject(operation.error);
    });
  }
  async function transaction(database, stores, mode, operation) {
    const tx = database.transaction(stores, mode);
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error("Index transaction aborted"));
      tx.onerror = () => {
      };
    });
    try {
      const result = await operation(tx);
      await completed;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
      }
      await completed.catch(() => {
      });
      throw error;
    }
  }
  var ReviewIndex = class _ReviewIndex {
    constructor(database, importId, timing) {
      this.database = database;
      this.importId = importId;
      this.timing = timing;
    }
    static async open(name, importId, timing, factory = globalThis.indexedDB) {
      if (!factory) throw Error("IndexedDB is unavailable; a persistent local review index is required");
      const opening = factory.open(name, 2);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        for (const name2 of ["meta", "files", "seen", "latest", "baselines"]) if (!db.objectStoreNames.contains(name2)) db.createObjectStore(name2);
        if (!db.objectStoreNames.contains("observations")) {
          const observations = db.createObjectStore("observations", {keyPath: "id"});
          observations.createIndex("card_id", "card_id");
        }
        if (!db.objectStoreNames.contains("activity")) {
          const activity = db.createObjectStore("activity", {keyPath: "id"}); activity.createIndex("day", "day");
        }
        if (!db.objectStoreNames.contains("introduced")) {
        const introduced = db.createObjectStore("introduced", { keyPath: ["day", "card_id"] });
        introduced.createIndex("day", "day");
        }
      };
      const database = await request(opening);
      database.onversionchange = () => database.close();
      const result = new _ReviewIndex(database, importId, timing);
      const stored = await result.get("meta", "import");
      if (stored !== importId || await result.get("meta", "schema") !== 2) {
        await result.clear();
        await result.put("meta", "import", importId);
        await result.put("meta", "schema", 2);
      }
      return result;
    }
    close() {
      this.database.close();
    }
    get(store, key) {
      return transaction(this.database, [store], "readonly", (tx) => request(tx.objectStore(store).get(key)));
    }
    put(store, key, value) {
      return transaction(this.database, [store], "readwrite", (tx) => request(tx.objectStore(store).put(value, key)));
    }
    async clear() {
      await transaction(this.database, ["files", "seen", "latest", "introduced", "baselines", "observations", "activity"], "readwrite", async (tx) => {
        await Promise.all(["files", "seen", "latest", "introduced", "baselines", "observations", "activity"].map((name) => request(tx.objectStore(name).clear())));
      });
    }
    async latest() {
      const events = await transaction(this.database, ["latest"], "readonly", (tx) => request(tx.objectStore("latest").getAll()));
      return new Map(events.map((event) => [event.card_id, event]));
    }
    async introducedToday(now) {
      const day = studyDay(now, this.timing);
      return transaction(this.database, ["introduced"], "readonly", (tx) => request(tx.objectStore("introduced").index("day").count(day)));
    }
    async historyFor(cardId) {
      return transaction(this.database,["observations"],"readonly",tx=>request(tx.objectStore("observations").index("card_id").getAll(cardId)));
    }
    async activityToday(now) {
      const day=studyDay(now,this.timing);
      return transaction(this.database,["activity"],"readonly",tx=>request(tx.objectStore("activity").index("day").getAll(day)));
    }
    async ingest(events, knownCards) {
      const records = await Promise.all(events.map(async (event) => {
        validateEvent(event, this.importId);
        if (event.kind !== "historical_review" && !knownCards.has(event.card_id)) throw Error(`Unknown review card: ${event.card_id}`);
        return { event, hash: await hash(canonical(event)), day: event.was_new ? studyDay(event.review_time_ms, this.timing) : null };
      }));
      await transaction(this.database, ["seen", "latest", "introduced", "observations", "activity"], "readwrite", async (tx) => {
        const seen = tx.objectStore("seen"), latest = tx.objectStore("latest");
        for (const record of records) {
          const previous = await request(seen.get(record.event.id));
          if (previous && previous !== record.hash) throw Error(`Conflicting contents for event ${record.event.id}`);
          if (previous) continue;
          await request(seen.put(record.hash, record.event.id));
          if (record.event.kind === "historical_review") {
            if (record.event.card_id) await request(tx.objectStore("observations").put(record.event));
            continue;
          }
          if (record.event.kind === "scheduling_baseline") continue;
          await request(tx.objectStore("activity").put({...record.event,day:studyDay(record.event.review_time_ms,this.timing)}));
          const state = await request(latest.get(record.event.card_id));
          if (!state || compare(record.event, state) > 0) await request(latest.put(record.event, record.event.card_id));
          if (record.day) await request(tx.objectStore("introduced").put({ day: record.day, card_id: record.event.card_id }));
        }
      });
    }
    /** Fingerprint unchanged files; parse only appended lines when prefix matches.
     * A replaced/deleted log triggers a full rebuild so no stale states survive.
     * Checkpoints commit only after every event in that file has been indexed.
     */
    async sync(files, read, knownCards, { progress = () => {
    }, force = /* @__PURE__ */ new Set() } = {}) {
      const cached = await transaction(this.database, ["files"], "readonly", async (tx) => {
        const store = tx.objectStore("files");
        const keys = await request(store.getAllKeys());
        const values = await request(store.getAll());
        return new Map(keys.map((key, i) => [key, values[i]]));
      });
      const present = new Set(files.map((file) => file.path));
      let reset = [...cached.keys()].some((path) => !present.has(path));
      let parsed = 0, readFiles = 0;
      if (reset) {
        await this.clear();
        cached.clear();
      }
      for (const file of files) {
        const old = cached.get(file.path);
        if (old && file.stat && old.mtime === file.stat.mtime && old.size === file.stat.size && !force.has(file.path)) continue;
        const text = await read(file);
        readFiles++;
        if (text && !text.endsWith("\n")) throw Error(`Incomplete final review record in ${file.path}`);
        let start = 0;
        if (old) {
          if (text.length >= old.length && await hash(text.slice(0, old.length)) === old.hash) start = old.length;
          else {
            await this.clear();
            const result = await this.sync(files, read, knownCards, { progress });
            return { ...result, rebuilt: true };
          }
        }
        let batch = [];
        while (start < text.length) {
          const end = text.indexOf("\n", start);
          const line = text.slice(start, end);
          start = end + 1;
          if (!line.trim()) continue;
          try {
            batch.push(JSON.parse(line));
          } catch {
            throw Error(`Malformed review record in ${file.path}`);
          }
          parsed++;
          if (batch.length === 500) {
            await this.ingest(batch, knownCards);
            batch = [];
            progress(parsed, file.path);
          }
        }
        if (batch.length) await this.ingest(batch, knownCards);
        await this.put("files", file.path, { mtime: file.stat?.mtime, size: file.stat?.size, length: text.length, hash: await hash(text) });
        progress(parsed, file.path);
      }
      return { parsed, readFiles, rebuilt: reset };
    }
  };


const US_STATES = {"alabama": "Alabama", "alaska": "Alaska", "arizona": "Arizona", "arkansas": "Arkansas", "california": "California", "colorado": "Colorado", "connecticut": "Connecticut", "delaware": "Delaware", "florida": "Florida", "georgia": "Georgia", "hawaii": "Hawaii", "idaho": "Idaho", "illinois": "Illinois", "indiana": "Indiana", "iowa": "Iowa", "kansas": "Kansas", "kentucky": "Kentucky", "louisiana": "Louisiana", "maine": "Maine", "maryland": "Maryland", "massachusetts": "Massachusetts", "michigan": "Michigan", "minnesota": "Minnesota", "mississippi": "Mississippi", "missouri": "Missouri", "montana": "Montana", "nebraska": "Nebraska", "nevada": "Nevada", "new-hampshire": "New Hampshire", "new-jersey": "New Jersey", "new-mexico": "New Mexico", "new-york": "New York", "north-carolina": "North Carolina", "north-dakota": "North Dakota", "ohio": "Ohio", "oklahoma": "Oklahoma", "oregon": "Oregon", "pennsylvania": "Pennsylvania", "rhode-island": "Rhode Island", "south-carolina": "South Carolina", "south-dakota": "South Dakota", "tennessee": "Tennessee", "texas": "Texas", "utah": "Utah", "vermont": "Vermont", "virginia": "Virginia", "washington": "Washington", "west-virginia": "West Virginia", "wisconsin": "Wisconsin", "wyoming": "Wyoming"};
// Browser implementation bundled into ../view.js by build.py. No runtime tooling.
function effectiveSettings(card, manifest) {
  if (!manifest.scheduling) return manifest.scheduler;
  const meta = manifest.scheduling;
  const deck = meta.decks[card.original_deck_id || card.deck_id];
  const preset = meta.presets[deck.normal.config_id || "1"];
  const s = preset.settings;
  const field = ["fsrs_params_6", "fsrs_params_5", "fsrs_params_4"].find(k => s[k]?.length);
  return {
    algorithm: "FSRS-6", weights: s[field] || [], parameter_field: field,
    parameter_policy: meta.parameter_policy, source_anki_version: meta.source_anki_version,
    preset_id: preset.id, desired_retention: deck.normal.desired_retention ?? s.desired_retention,
    maximum_interval: s.maximum_review_interval, minimum_interval: s.minimum_lapse_interval,
    learning_steps: s.learn_steps, relearning_steps: s.relearn_steps,
    new_cards_per_day: s.new_per_day, enable_fuzz: false,
    short_term_with_steps: Boolean(meta.collection.fsrsShortTermWithStepsEnabled)
  };
}
function schedulerV2(options) {
  validateOptions(options);
  if (options.weights) {
    if (!options.parameter_policy) throw Error("Source Anki version is unconfirmed. Run desktop verification before rating.");
    if (![17, 19, 21].includes(options.weights.length) || options.weights.some(x => !Number.isFinite(x)))
      throw Error("Unsupported trained scheduler parameters");
  }
  const engine = fsrs({request_retention: options.desired_retention, maximum_interval: options.maximum_interval,
    enable_fuzz: false, w: options.weights,
    ...(options.learning_steps ? {learning_steps: options.learning_steps.map(x => `${x}m`)} : {}),
    ...(options.relearning_steps ? {relearning_steps: options.relearning_steps.map(x => `${x}m`)} : {})});
  // Anki permits initial stability below the bundled library's 0.1 floor.
  engine.init_stability = rating => engine.param.w[rating - 1];
  // The native short-term model prevents Hard from reducing stability too.
  engine.next_short_term_stability = (s, rating) => {
    const w = engine.param.w;
    const growth = Math.pow(s, -w[19]) * Math.exp(w[17] * (rating - 3 + w[18]));
    return Math.min(36500, Math.max(.001, s * (rating >= 2 ? Math.max(1, growth) : growth)));
  };
  return engine;
}
function renderV2(template, fields, ordinal = 0, answer = false) {
  if (/<script\b|\bon\w+\s*=|javascript:/i.test(template)) throw Error("Unsupported template operation: JavaScript");
  const token = /{{([#/^]?)([^{}]+)}}/g;
  const stack = [{visible: true, name: null}];
  let output = "", offset = 0;
  const value = expression => {
    const parts = expression.split(":"), key = parts.pop();
    if (!Object.hasOwn(fields, key)) throw Error(`Missing template field: ${key}`);
    let v = String(fields[key] ?? "");
    for (const filter of parts.reverse()) {
      if (filter === "cloze") v = v.replace(/{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/g,
        (_, n, body, hint) => +n === ordinal + 1 ? answer ? body : `[${hint || "…"}]` : body);
      else if (filter === "text") v = v.replace(/<[^>]*>/g, "");
      else if (filter === "type") throw Error("Unsupported template operation: type-answer input");
      else throw Error(`Unsupported template filter: ${filter}`);
    }
    return v;
  };
  for (const match of template.matchAll(token)) {
    if (stack.at(-1).visible) output += template.slice(offset, match.index);
    const [, marker, key] = match;
    if (marker === "#" || marker === "^") {
      const present = value(key).trim() !== "";
      stack.push({name: key, visible: stack.at(-1).visible && (marker === "#" ? present : !present)});
    } else if (marker === "/") {
      if (stack.length === 1 || stack.pop().name !== key) throw Error(`Unbalanced template section: ${key}`);
    } else if (stack.at(-1).visible) output += value(key);
    offset = match.index + match[0].length;
  }
  if (stack.length !== 1 || /{{|}}/.test(template.replace(token, ""))) throw Error("Unsupported template syntax");
  return output + template.slice(offset);
}
function transformField(name, value, note) {
  const text = v => v == null ? "" : String(v).trim();
  const list = v => Array.isArray(v) ? v : [v];
  const label = v => text(v).replace(/^!?\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]$/, (_, p, l) => l || p.split("/").at(-1).replace(/\.md$/, ""));
  const media = v => list(v).filter(x => text(x)).map(x => {
    const m = text(x).match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if (!m) throw Error(`Expected vault media reference: ${text(x)}`);
    return `![[${m[1]}]]`;
  }).join("\n");
  switch (name) {
    case "text": case "markdown_body": return text(value);
    case "capitalize": return text(value).replace(/^./, x => x.toUpperCase());
    case "functional_group_name": return text(value).replace(/-group$/i, "").replace(/^./, x => x.toUpperCase());
    case "ph_front": return text(note.metadata.name_zh) || text(note.metadata.name_en) || note.filename;
    case "ph_units": return "pH";
    case "first_alias": if (!Array.isArray(value) || !text(value[0])) throw Error("Missing first alias"); return text(value[0]);
    case "chinese_alias": {const v = list(value).find(x => /\p{Script=Han}/u.test(text(x))); if (!v) throw Error("Missing Chinese alias"); return text(v);}
    case "wikilink_label": return label(value);
    case "comma_separated_labels": return list(value).map(label).filter(Boolean).join(", ");
    case "image": case "image_list": case "optional_image": case "sound": return media(value);
    case "country_flags": return [note.metadata.flag_blur, value].filter(x => text(x)).map(media).join("\n");
    case "image_or_text": return Array.isArray(value) || /^!?\[\[/.test(text(value)) ? media(value) : text(value);
    case "chemical_structure": {const v = note.metadata.structure_image || note.metadata.structure_latex || note.metadata.structure; return v ? transformField("image_or_text", v, note) : "";}
    case "markdown_link_list": return list(value).map(text).filter(Boolean).join("\n\n");
    case "indian_union_territory": return note.path.split("/").at(-2) === "union-territories" ? "Yes" : "No";
    case "us_state_name": {const v = note.lookups?.us_states?.[note.filename.toLowerCase()]; if (!v) throw Error("Unknown US state filename"); return v;}
    case "classical_back": {const composer = label(note.metadata.composer); if (!composer) throw Error("Missing composer"); return `${composer} - ${text(value)}${note.metadata.info ? "\n\n" + text(note.metadata.info) : ""}`;}
    default: throw Error(`Unsupported source transformation: ${name}`);
  }
}
function fieldsFromNote(card, note) {
  const specs = card.source.fields || Object.entries(card.source.field_map || {}).map(([anki, source]) => ({anki, source, transform: "text", required: false}));
  const fields = {};
  for (const spec of specs) {
    let value = spec.source === "$filename" ? note.filename : spec.source === "$body" ? note.body : note.metadata[spec.source];
    if (value === undefined && spec.required && !["blank", "omit"].includes(spec.missing_source) && spec.transform !== "optional_image")
      throw Error(`Missing source field: ${spec.source}`);
    fields[spec.anki] = transformField(spec.transform, value, note);
  }
  for (const key of card.template.required_fields) if (!String(fields[key] ?? "").trim()) throw Error(`Missing required field: ${key}`);
  return fields;
}
function prepareTaxonomy(notes) {
  const normalized = s => s.normalize("NFC").toLowerCase().replace(/\.md$/i, "");
  const exact = new Map(), stems = new Map(), parents = new Map();
  for (const note of notes) {
    const key = normalized(note.path.replace(/^.*?wiki\/life\//, ""));
    exact.set(key,note);const stem=normalized(note.filename);
    stems.set(stem,[...(stems.get(stem)||[]),note]);parents.set(note.path,[]);
  }
  for(const parent of notes) for(const item of [parent.metadata.child,parent.metadata.children].flat().filter(Boolean)) {
    const m=String(item).match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if(!m)throw Error(`Invalid taxonomy child: ${item}`);
    const target=normalized(m[1].replace(/^wiki\/life\//,""));
    let child=exact.get(target);
    if(!child){const matches=stems.get(target.split("/").at(-1))||[];if(matches.length>1)throw Error(`Ambiguous taxonomy child: ${item}`);child=matches[0];}
    if(child)parents.get(child.path).push(parent);
  }
  const output=new Map();
  for(const note of notes) {
    const byRank=new Map(),seen=new Set();
    const visit=(n,visiting)=>{
      if(visiting.has(n.path))throw Error("Cycle in taxonomy ancestry");
      if(seen.has(n.path))return;seen.add(n.path);
      const m=n.filename.match(/^(\S+)\s+(.+)$/);if(!m)throw Error("Taxonomy filename must be '<rank> <scientific name>'");
      const key=m[1].toLowerCase();byRank.set(key,[...new Set([...(byRank.get(key)||[]),m[2]])]);
      for(const p of parents.get(n.path))visit(p,new Set([...visiting,n.path]));
    };visit(note,new Set());
    const [rank,...scientific]=note.filename.split(" ");
    const get=r=>(byRank.get(r)||[]).join("; ");
    const kingdom=get("kingdom");let family=get("family");
    if(kingdom.toLowerCase()==="plantae")family=[family,get("subfamily"),get("tribe")].filter(Boolean).join(" - ");
    const familyDisplay=family&&kingdom?`${family} (${kingdom})`:family||(kingdom?`(${kingdom})`:"");
    output.set(note.path,{...note.metadata,$taxonomy_rank:rank,$taxonomy_scientific_name:scientific.join(" "),$taxonomy_genus:get("genus"),$taxonomy_family:familyDisplay});
  }
  return output;
}
function dayNumber(now, timing) {
  return Math.round((Date.parse(studyDay(now, timing)) - Date.parse(timing.day_zero)) / 86400000);
}
function queueKind(card, value, manifest, now, today = dayNumber(now, manifest.timing)) {
  if (card.retired) return null;
  const state = value?.state;
  let q = state?.queue ?? card.queue;
  const lastUnburied = manifest.scheduling?.collection.lastUnburied ?? 0;
  if ((q === -2 || q === -3) && (today > lastUnburied || today + 7 < lastUnburied))
    q = card.card_type === 0 ? 0 : card.card_type === 2 ? 2 : card.scheduling?.due > 1e9 ? 1 : 3;
  if (q < 0) return null;
  if (q === 0) return "new";
  if (q === 1) return (state?.due ?? card.due_ms) < now + (manifest.scheduling?.collection.collapseTime ?? 1200) * 1000 ? "intraday" : null;
  if (q === 4) return (state?.due ?? card.due_ms) <= now + (manifest.scheduling?.collection.collapseTime ?? 1200) * 1000 ? "intraday" : null;
  if (q === 2 || q === 3) {
    const dueDay = state?.anki_due ?? card.anki_due;
    const due = dueDay !== undefined ? dueDay <= today : state?.due <= now;
    return due ? q === 3 ? "interday" : "review" : null;
  }
  return null;
}
function deckTree(cards, states, manifest, now, activity = []) {
  const meta = manifest.scheduling;
  if (!meta) return [];
  const today = dayNumber(now, manifest.timing);
  const nodes = new Map(Object.values(meta.decks).map(deck => [deck.id, {...deck, children: [],
    new: 0, review: 0, intraday: 0, interday: 0, errors: 0, total: 0}]));
  for (const c of cards) {
    const node = nodes.get(c.deck_id);
    if (!node) continue;
    node.total++;
    if (c.content_error) node.errors++;
    const kind = queueKind(c, states.get(c.id), manifest, now, today);
    if (kind) node[kind]++;
  }
  const roots = [];
  for (const n of nodes.values()) (nodes.get(n.parent_id)?.children || roots).push(n);
  const added = new Map(), introduced = new Set();
  const byCard = new Map(cards.map(c => [c.id, c]));
  const currentDay = studyDay(now, manifest.timing);
  for (const event of activity) {
    if (event.kind === "historical_review" || event.kind === "scheduling_baseline" || studyDay(event.review_time_ms, manifest.timing) !== currentDay) continue;
    const card = byCard.get(event.card_id);
    if (!card) continue;
    if (event.was_new && introduced.has(card.id)) continue;
    if (event.was_new) introduced.add(card.id);
    let node = nodes.get(card.original_deck_id || card.deck_id);
    while (node) {
      const value = added.get(node.id) || {new: 0, review: 0};
      if (event.was_new) value.new++;
      else if (event.was_review ?? event.state.state === State.Review) value.review++;
      added.set(node.id, value);
      node = nodes.get(node.parent_id);
    }
  }
  const visit = (n, parent) => {
    const preset = meta.presets[n.normal.config_id || "1"]?.settings;
    let limits = {new: 9999, review: 9999};
    if (!n.filtered && preset) {
      const limit = (kind, fallback) => {
        const override = n.normal[`${kind}_limit_today`];
        return override && (override.today ?? 0) === today ? override.limit ?? 0 : n.normal[`${kind}_limit`] ?? fallback;
      };
      const counts = n.common.last_day_studied === today ? n.common : {};
      const extra = added.get(n.id) || {};
      const studiedNew = (counts.new_studied || 0) + (extra.new || 0);
      const studiedReview = (counts.review_studied || 0) + (extra.review || 0);
      limits.review = Math.max(0, limit("review", preset.reviews_per_day) - studiedReview - (meta.collection.newCardsIgnoreReviewLimit ? 0 : studiedNew));
      limits.new = Math.max(0, limit("new", preset.new_per_day) - studiedNew);
      if (!meta.collection.newCardsIgnoreReviewLimit) limits.new = Math.min(limits.new, limits.review);
    }
    if (parent && meta.collection.applyAllParentLimits) {
      limits.new = Math.min(limits.new, parent.new); limits.review = Math.min(limits.review, parent.review);
    }
    n.children.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const child of n.children) {
      visit(child, limits);
      for (const kind of ["new", "review", "intraday", "interday", "errors", "total"]) n[kind] += child[kind];
    }
    n.interday = Math.min(n.interday, limits.review);
    n.review = Math.min(n.review, limits.review - n.interday);
    n.new = Math.min(n.new, limits.new);
    if (!n.filtered && !meta.collection.newCardsIgnoreReviewLimit) n.new = Math.min(n.new, limits.review - n.interday - n.review);
    n.learning = n.intraday + n.interday;
  };
  roots.sort((a,b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  roots.forEach(n => visit(n, null));
  return roots.filter(n => !(n.id === "1" && n.total === 0 && !n.children.length && roots.length > 1));
}
function reviewQueueV2(cards, states, events, manifest, now, group, introducedCount, deckId = null, skipped = new Set()) {
  if (!manifest.scheduling) return reviewQueue(cards, states, events, manifest, now, group, introducedCount);
  const tree = deckTree(cards, states, manifest, now, events);
  const nodesById = new Map(), kinds = new Map(), today = dayNumber(now, manifest.timing);
  const kindOf = c => {
    if (!kinds.has(c.id)) kinds.set(c.id, queueKind(c, states.get(c.id), manifest, now, today));
    return kinds.get(c.id);
  };
  const find = nodes => {for (const n of nodes) {nodesById.set(n.id,n); find(n.children);}};
  find(tree);
  const node = nodesById.get(deckId);
  const selected = node ? [node] : tree;
  const allowed = new Map();
  const allocate = n => {
    const ids = new Set();
    const gather = p => {ids.add(p.id); p.children.forEach(gather);}; gather(n);
    const eligible = cards.filter(c => ids.has(c.deck_id) && (!group || c.group === group) && states.has(c.id));
    const budget = {new:n.new,review:n.review,interday:n.interday,intraday:n.intraday};
    eligible.sort((a,b) => Number(skipped.has(a.id))-Number(skipped.has(b.id)) || (a.anki_due ?? 0) - (b.anki_due ?? 0) || a.id.localeCompare(b.id));
    const used = new Map();
    for (const kind of ["intraday", "interday", "review", "new"]) for (const c of eligible) {
      if (budget[kind] <= 0 || kindOf(c) !== kind) continue;
      let path = manifest.scheduling.decks[c.deck_id], ok = true;
      const ancestors = [];
      while (path) {
        ancestors.push(path.id);
        const entry = used.get(path.id) || {new:0,review:0,interday:0,intraday:0};
        const target = nodesById.get(path.id);
        if (target && entry[kind] >= target[kind]) ok = false;
        if (path.id === n.id) break;
        path = manifest.scheduling.decks[path.parent_id];
      }
      if (!ok) continue;
      for (const id of ancestors) {const entry = used.get(id) || {new:0,review:0,interday:0,intraday:0};entry[kind]++;used.set(id,entry);}
      budget[kind]--; allowed.set(c.id,c);
    }
  };
  selected.forEach(allocate);
  const chosen = [...allowed.values()];
  const priority = c => {
    const kind=kindOf(c);
    return kind==="intraday" ? (states.get(c.id).state.due>now?4:0) : kind==="interday"?1:kind==="review"?2:3;
  };
  chosen.sort((a,b)=>priority(a)-priority(b) || (states.get(a.id).state.due||0)-(states.get(b.id).state.due||0) || a.id.localeCompare(b.id));
  return {cards: chosen, fresh: chosen.filter(c => kindOf(c) === "new").length,
    learning:chosen.filter(c => ["intraday","interday"].includes(kindOf(c))).length,
    review:chosen.filter(c => kindOf(c) === "review").length, tree};
}
function nextStateV2(card, current, options, manifest, now, rating) {
  if (![1,2,3,4].includes(rating)) throw Error("Invalid rating");
  if (current.last_review !== undefined && now < current.last_review) throw Error("Device clock precedes last review");
  if (manifest.scheduling?.decks[card.deck_id]?.filtered) throw Error("Filtered-deck answering requires returning cards to their original deck in Anki before migration");
  const engine = schedulerV2(options);
  // Anki measures whole 24-hour periods back from the next cutoff, using
  // today's UTC offset. Counting historical local dates differs across DST.
  const clock = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:manifest.timing.timezone,
    hour:"numeric", minute:"numeric", second:"numeric", hourCycle:"h23"})
    .formatToParts(new Date(now)).map(p => [p.type,p.value]));
  const sinceMidnight = +clock.hour * 3600 + +clock.minute * 60 + +clock.second;
  const untilRollover = (manifest.timing.rollover_hour * 3600 - sinceMidnight + 86400) % 86400 || 86400;
  const nextCutoff = Math.floor(now / 1000) + untilRollover;
  const elapsed = current.last_review === undefined ? 0 :
    Math.max(0, Math.floor((nextCutoff - Math.floor(current.last_review / 1000)) / 86400));
  const memories = [1,2,3,4].map(r => engine.next_state(current.state===State.New ? null : {stability:current.stability,difficulty:current.difficulty},elapsed,r));
  const interval = m => m.stability * engine.intervalModifier;
  const capped = (value,min=1) => Math.min(options.maximum_interval,Math.max(min,Math.round(value)));
  const memory = memories[rating-1];
  const state = {...current,stability:memory.stability,difficulty:memory.difficulty,elapsed_days:elapsed,
    last_review:now,reps:current.reps+1,lapses:current.lapses,queue:2,state:State.Review,
    learning_steps:0,remaining_steps:0};
  let seconds, remaining = 0;
  let days = capped(interval(memory));
  const relearning = current.state===State.Relearning || current.state===State.Review && rating===1;
  const steps = relearning ? options.relearning_steps || [10] : options.learning_steps || [1,10];
  if (current.state!==State.Review || rating===1) {
    const total=steps.length;
    const originalRemaining = current.state===State.New || current.state===State.Review ? total :
      current.remaining_steps ?? Math.max(0,total-current.learning_steps);
    const position=Math.max(0,Math.min(total-1,total-originalRemaining));
    if(rating===1 && total) {seconds=Math.trunc(steps[0]*60);remaining=total;}
    else if(rating===2 && total) {
      const delay=Math.trunc(steps[position]*60);
      seconds=position===0 ? total>1 ? Math.trunc((delay+Math.trunc(steps[1]*60))/2) : Math.min(Math.trunc(delay*1.5),delay+86400) : delay;
      if(seconds>86400)seconds=Math.round(seconds/86400)*86400;
      remaining=originalRemaining;
    } else if(rating===3 && position+1<total) {seconds=Math.trunc(steps[position+1]*60);remaining=total-position-1;}
    if(rating===4)days=capped(interval(memory),capped(interval(memories[2]))+1);
    if(seconds===undefined && rating!==4 && (total===0 || options.short_term_with_steps) && interval(memory)<.5) {
      seconds=Math.max(1,Math.trunc(interval(memory)*86400));remaining=originalRemaining;
    }
    if(current.state===State.Review && rating===1)state.lapses++;
  } else {
    const hard=capped(interval(memories[1]));
    const good=capped(interval(memories[2]),hard+1);
    const easy=capped(interval(memories[3]),good+1);
    days=[days,hard,good,easy][rating-1];
  }
  if(seconds!==undefined) {
    state.scheduled_secs=seconds;
    state.state=relearning?State.Relearning:State.Learning;
    state.scheduled_days=relearning ? rating===1?days:current.scheduled_days : 0;
    state.remaining_steps=remaining;state.learning_steps=Math.max(0,steps.length-remaining);
    state.due=now+seconds*1000;
    state.queue=state.due>=studyDayStart(dayNumber(now,manifest.timing)+1,manifest.timing)?3:1;
    if(state.queue===3) {
      state.anki_due=dayNumber(now,manifest.timing)+Math.max(1,Math.round(seconds/86400));
      state.due=studyDayStart(state.anki_due,manifest.timing);
    } else delete state.anki_due;
  } else {
    delete state.scheduled_secs;
    state.scheduled_days=days;state.anki_due=dayNumber(now,manifest.timing)+days;
    state.due=studyDayStart(state.anki_due,manifest.timing);
  }
  return state;
}
function studyDayStart(day, timing) {
  const target = Date.parse(timing.day_zero) + day * 86400000 + timing.rollover_hour * 3600000;
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:timing.timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    guess += target - Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  }
  return guess;
}

  if (globalThis.__SRS_TEST__) {
    globalThis.SRS = {schedulerV2, effectiveSettings, renderV2, transformField, fieldsFromNote,
      deckTree, queueKind, reviewQueueV2, nextStateV2, studyDay, studyDayStart, dayNumber,
      ReviewIndex, appendReview, validateEvent, parseCSV, indexRows, configuredCards, initialState};
    return;
  }
  (async () => {
    const api = dv.app, component = dv.component;
    const root = input?.root || "ankobs-srs", dataRoot = `${root}/data`;
    const identity = `ankobs-srs:${api.vault.getName()}:${root}`;
    const host = dv.container.createDiv({cls:"ankobs-srs"});
    const notice = host.createDiv(), controls = host.createDiv();
    const home = controls.createEl("button",{text:"Decks"});
    const select = controls.createEl("select");
    const deviceSelect = controls.createEl("select",{attr:{"aria-label":"This device"}});
    const refresh = controls.createEl("button",{text:"Refresh"});
    const rebuild = controls.createEl("button",{text:"Rebuild local index"});
    const counts = host.createDiv(), homepage = host.createDiv(), front = host.createDiv(), back = host.createDiv();
    const actions = host.createDiv(), source = host.createDiv();
    const dirty = new Set(), cache = new Map(), skipped = new Set();
    let taxonomy;
    let resolvedCards, resolvedConfig, sourceGeneration = 0, resolvedGeneration = -1;
    const candidateSources = new Map();
    let manifest, cards = [], config, index, states, shown, configKey, started = 0;
    let busy = false, disposed = false, refreshTimer, pending = false, selectedDeck = null;
    let reviewing = Boolean(input?.group);
    let deviceId = input?.device || localStorage.getItem(`${identity}:device-name`);
    if (!["computer","android"].includes(deviceId))deviceId=/Android/i.test(globalThis.navigator?.userAgent||"")?"android":"computer";
    for(const name of ["computer","android"])deviceSelect.createEl("option",{value:name,text:`Device: ${name}`});
    deviceSelect.value=deviceId;
    localStorage.setItem(`${identity}:device-name`,deviceId);
    deviceSelect.onchange=()=>{deviceId=deviceSelect.value;localStorage.setItem(`${identity}:device-name`,deviceId);};
    component.register(() => {disposed=true;clearTimeout(refreshTimer);index?.close();});
    const store = {
      async list(directory) {return api.vault.getFiles().filter(f=>f.path.startsWith(directory+"/"));},
      async read(path) {const f=api.vault.getAbstractFileByPath(path);return f ? api.vault.read(f) : null;},
      async create(path,text) {await api.vault.create(path,text);},
      async append(path,text) {const f=api.vault.getAbstractFileByPath(path);if(!f)throw Error(`Missing log: ${path}`);await api.vault.append(f,text);}
    };
    async function json(path) {const text=await store.read(path);if(text===null)throw Error(`Missing SRS file: ${path}`);return JSON.parse(text);}
    function message(e) {notice.textContent=String(e.message||e);}
    function clearCard() {front.empty();back.empty();actions.empty();source.empty();homepage.empty();shown=null;}
    function logFiles() {return api.vault.getFiles().filter(f=>
      f.path.startsWith(`${dataRoot}/reviews/`) && LOG_PATTERN.test(f.path.split("/").at(-1)))
      .map(f=>({path:f.path,stat:f.stat?{...f.stat}:undefined}));}
    async function syncIndex() {
      const force=new Set([...dirty].filter(p=>p.startsWith(`${dataRoot}/reviews/`)));
      await index.sync(logFiles(),async f=>{const t=await store.read(f.path);if(t===null)throw Error(`Log disappeared: ${f.path}`);return t;},new Set(cards.map(c=>c.id)),{
        force, progress:n=>{if(!disposed && n>=500)notice.textContent=`Indexing reviews: ${n.toLocaleString()}…`;}
      });
      for(const path of force)dirty.delete(path);
    }
    async function noteAt(file) {
      let stored=cache.get(file.path);
      if(!stored || !file.stat || stored.mtime!==file.stat.mtime || stored.size!==file.stat.size || dirty.has(file.path)) {
        const text=await api.vault.read(file);
        if(file.path.endsWith(".csv")) stored={rows:indexRows(parseCSV(text))};
        else {
          // Obsidian owns YAML parsing on both supported platforms.
          const metadata=api.metadataCache.getFileCache(file)?.frontmatter || {};
          stored={metadata,body:text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,""),text};
        }
        Object.assign(stored,{mtime:file.stat?.mtime,size:file.stat?.size});cache.set(file.path,stored);dirty.delete(file.path);
      }
      return stored;
    }
    async function resolveSource(card) {
      if(!card.template)throw Error("No editable template mapped to this Anki card ordinal");
      if(!card.template.enabled)throw Error("Template disabled in config.json");
      if(!card.source)throw Error("Unresolved vault source");
      if(card.source.error)throw Error(card.source.error);
      let path=card.source.path;
      if(!path && card.source.candidates) {
        const key=canonical(card.source.candidates);
        if(!candidateSources.has(key)) {
          const identities=new Map();
          for(const file of api.vault.getFiles().filter(f=>card.source.candidates.some(p=>f.path===p||f.path.startsWith(p+"/")))) {
            const note=await noteAt(file);
            const uids=note.rows ? note.rows.keys() : [note.metadata?.anki_note_id ? `anki:${note.metadata.anki_note_id}` : `local:${note.metadata?.srs_uid}`];
            for(const uid of uids) {
              if(!identities.has(uid))identities.set(uid,[]);
              identities.get(uid).push(file.path);
            }
          }
          candidateSources.set(key,identities);
        }
        const matches=candidateSources.get(key).get(card.note_uid)||[];
        if(matches.length!==1)throw Error(matches.length?"Duplicate vault source identity":"Unresolved vault source");
        path=matches[0];
      }
      const file=api.vault.getAbstractFileByPath(path);
      if(!file)throw Error(`Missing vault source: ${path}`);
      const data=await noteAt(file);
      let metadata=data.rows?data.rows.get(card.note_uid):data.metadata;
      if(card.source.prepare==="prepare_taxonomy_notes") {
        if(!taxonomy) {
          const notes=[];
          for(const f of api.vault.getFiles().filter(f=>f.path.startsWith("wiki/life/")&&f.path.endsWith(".md"))) {
            const parsed=await noteAt(f);
            if(Object.keys(parsed.metadata).length)notes.push({path:f.path,filename:f.basename||f.path.split("/").at(-1).replace(/\.md$/,""),metadata:parsed.metadata});
          }
          taxonomy=prepareTaxonomy(notes);
        }
        metadata=taxonomy.get(path)||metadata;
      }
      if(card.source.kind==="block") {
        const matches=[...data.text.matchAll(/^>[ \t]*\[!anki\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n((?:^>[ \t]?(?!\[!anki\](?:-|[ \t]))[^\r\n]*(?:\r?\n|$))+?)^[ \t]*<!--[ \t]*ID[ \t]*:[ \t]*(\d+)[ \t]*-->[ \t]*$/gmi)].filter(m=>`anki:${m[3]}`===card.note_uid);
        if(matches.length!==1)throw Error(matches.length?"Duplicate block identity":"Missing Markdown block identity");
        metadata={$front:matches[0][1].trim(),$back:matches[0][2].split(/\r?\n/).map(l=>l.replace(/^>[ \t]?/,"")).filter(l=>!/^\s*(?:#[^\s#]+\s*)+$/.test(l)).join("\n").trim()};
      }
      if(!metadata)throw Error(`Missing source identity: ${card.note_uid}`);
      if(!data.rows && (metadata.anki_note_id || metadata.srs_uid)) {
        const uid=metadata.anki_note_id?`anki:${metadata.anki_note_id}`:`local:${metadata.srs_uid}`;
        if(uid!==card.note_uid)throw Error("Source identity changed");
      }
      const note={metadata,body:data.body,filename:file.basename||file.path.split("/").at(-1).replace(/\.md$/,""),path,lookups:{us_states:US_STATES}};
      const fields=fieldsFromNote(card,note);
      const special={...fields,Deck:manifest.scheduling?.decks[card.deck_id]?.name||"",Subdeck:manifest.scheduling?.decks[card.deck_id]?.name.split("::").at(-1)||"",Card:card.template.key,Type:card.anki_notetype,Tags:Array.isArray(metadata.tags)?metadata.tags.join(" "):String(metadata.tags||"")};
      const frontText=renderV2(card.template.front,special,card.anki_ordinal,false);
      const backText=renderV2(card.template.back,{...special,FrontSide:frontText},card.anki_ordinal,true);
      if(!frontText.trim() || !backText.trim())throw Error("Template produced an empty question or answer");
      return {...card,source:{...card.source,path},fields,frontText,backText};
    }
    async function readSources() {
      if(resolvedCards && resolvedConfig===configKey && resolvedGeneration===sourceGeneration)return resolvedCards;
      const generation=sourceGeneration;
      taxonomy=null;
      candidateSources.clear();
      const result=[];
      for(const card of configuredCards(cards,config)) {
        try {result.push(await resolveSource(card));}
        catch(e) {result.push({...card,content_error:e.message});}
      }
      resolvedCards=result;resolvedConfig=configKey;resolvedGeneration=generation;
      return result;
    }
    function current(card,baseline,latest) {return latest?{state:latest.state,parent:latest.id}:{state:baseline,parent:`import:${manifest.import_id}:${card.id}`};}
    async function baseline(card) {
      if(card.baseline)return card.baseline;
      const options=effectiveSettings(card,manifest);
      const key=`${card.id}:${await hash(canonical(options))}`;
      let state=await index.get("baselines",key);
      if(!state) {
        const history=card.history || (card.history_path ? (await json(`${dataRoot}/${card.history_path}`))[card.id] : await index.historyFor(card.id));
        state=initialState({...card,history},schedulerV2(options));
        if(card.scheduling)Object.assign(state,{reps:card.scheduling.reps,lapses:card.scheduling.lapses,
          scheduled_days:card.scheduling.ivl,queue:card.queue,anki_due:card.anki_due,
          learning_steps:Math.max(0,(card.card_type===3?options.relearning_steps:options.learning_steps).length-card.scheduling.left%1000)});
        await index.put("baselines",key,state);
      }
      return state;
    }
    function showCounts(el,n) {
      el.createEl("span",{text:`${n.new ?? n.fresh ?? 0} new`,cls:"srs-new"});
      el.createEl("span",{text:` · ${n.learning||0} learning`,cls:"srs-learning"});
      el.createEl("span",{text:` · ${n.review||0} review`,cls:"srs-review"});
      if(n.errors)el.createEl("span",{text:` · ${n.errors} content errors`,cls:"srs-errors"});
    }
    function contentProblems(available) {
      return available.filter(c=>c.content_error && (!select.value || c.group===select.value) &&
        (!selectedDeck || manifest.scheduling.decks[c.deck_id]?.name===manifest.scheduling.decks[selectedDeck]?.name ||
          manifest.scheduling.decks[c.deck_id]?.name.startsWith(manifest.scheduling.decks[selectedDeck]?.name+"::")));
    }
    function showErrors(available) {
      const problems=contentProblems(available);
      if(!problems.length)return;
      const details=homepage.createEl("details");details.createEl("summary",{text:`Inspect ${problems.length} content errors`});
      let offset=0,more;
      const page=()=>{
        if(more)more.disabled=true;
        for(const card of problems.slice(offset,offset+50)) {
          const row=details.createDiv();row.createEl("p",{text:`${card.anki_notetype||"Card"} · ${card.note_uid||card.id}: ${card.content_error}`});
          if(card.source?.path)row.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
        }
        offset+=50;if(offset<problems.length){more=details.createEl("button",{text:"Show more errors"});more.onclick=page;}
      };
      details.ontoggle=()=>{if(details.open && offset===0)page();};
    }
    async function draw() {
      if(disposed)return;
      clearCard();counts.empty();notice.textContent="";
      if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Card catalog changed; reopen this view");
      config=await json(`${root}/config.json`);configKey=canonical(config);
      const snapshot=await withStoreLock(identity,async()=>{await syncIndex();return {latest:await index.latest(),activity:await index.activityToday(Date.now())};});
      const available=await readSources();states=new Map();
      for(const card of available) {
        const projection=card.baseline || {state:card.queue===0?State.New:card.card_type===3?State.Relearning:card.queue===2?State.Review:State.Learning,due:card.due_ms,queue:card.queue,anki_due:card.anki_due};
        states.set(card.id,current(card,projection,snapshot.latest.get(card.id)));
      }
      const queue=reviewQueueV2(available,states,snapshot.activity,manifest,Date.now(),select.value,undefined,selectedDeck,skipped);
      const errors=contentProblems(available).length;
      if(!reviewing && manifest.scheduling) {
        const build=(nodes,container)=>{for(const n of nodes) {
          const details=container.createEl("details"),summary=details.createEl("summary");
          summary.createEl("span",{text:n.name.split("::").at(-1)+" · "});showCounts(summary,n);
          const open=summary.createEl("button",{text:"Review"});
          open.onclick=e=>{e.preventDefault();selectedDeck=n.id;reviewing=true;guardedDraw();};
          build(n.children,details);
        }};build(queue.tree,homepage);showErrors(available);notice.textContent=`${cards.length.toLocaleString()} cards · ${errors.toLocaleString()} content errors`;
        return;
      }
      showCounts(counts,{...queue,errors});
      showErrors(available);
      // Session skips do not change states, event logs, or the displayed counts.
      const card=queue.cards.find(c=>!skipped.has(c.id));
      if(!card){front.textContent="No cards ready for review in this session.";return;}
      shown=card;started=Date.now();
      const skip=()=>{skipped.add(card.id);guardedDraw();};
      actions.createEl("button",{text:"Bury"}).onclick=skip;
      if(card.source?.path)source.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
      if(card.content_error){front.textContent=card.content_error;actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      dv.el("div",card.frontText,{container:front});
      let options;
      try {options=effectiveSettings(card,manifest);schedulerV2(options);if(!snapshot.latest.has(card.id))states.set(card.id,current(card,await baseline(card)));}
      catch(e){message(e);actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      const reveal=actions.createEl("button",{text:"Show answer"});
      reveal.onclick=()=>{
        if(busy||shown!==card)return;
        try {
          dv.el("div",card.backText,{container:back});actions.empty();
          actions.createEl("button",{text:"Bury"}).onclick=skip;
          for(const [i,label]of["Again","Hard","Good","Easy"].entries()) {
            const preview=nextStateV2(card,states.get(card.id).state,options,manifest,Date.now(),i+1);
            const minutes=Math.max(0,Math.round((preview.due-Date.now())/60000));
            actions.createEl("button",{text:`${label} (${minutes<1440?minutes+"m":Math.round(minutes/1440)+"d"})`}).onclick=()=>answer(card,i+1);
          }
        }catch(e){message(e);actions.empty();actions.createEl("button",{text:"Bury"}).onclick=skip;}
      };
    }
    async function answer(card,rating) {
      if(busy||shown!==card||card.content_error)return;
      busy=true;actions.querySelectorAll("button").forEach(b=>b.disabled=true);
      try {
        const result=await withStoreLock(identity,async()=>{
          if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Catalog changed; reopen the view");
          if(canonical(await json(`${root}/config.json`))!==configKey)return "Configuration changed. Queue refreshed.";
          await syncIndex();
          const value=current(card,states.get(card.id).state,await index.get("latest",card.id));
          if(value.parent!==states.get(card.id).parent)return "Card reviewed on another device. Queue refreshed.";
          const live=await resolveSource(card);
          if(canonical(live.fields)!==canonical(card.fields))return "Source changed. Queue refreshed.";
          const now=Date.now(),options=effectiveSettings(card,manifest);
          const event={format_version:2,kind:"answer",id:crypto.randomUUID(),device_id:deviceId,card_id:card.id,
            deck_id:card.original_deck_id||card.deck_id,import_id:manifest.import_id,parent:value.parent,
            review_time_ms:now,duration_ms:Math.max(0,now-started),rating,was_new:value.state.state===State.New,
            was_review:value.state.state===State.Review,scheduler_version:SCHEDULER_VERSION,
            scheduler_config:options,state:nextStateV2(card,value.state,options,manifest,now,rating)};
          validateEvent(event,manifest.import_id);
          dirty.add(await appendReview(store,`${dataRoot}/reviews`,event));await syncIndex();return null;
        });
        await draw();if(result)notice.textContent=result;
      }catch(e){clearCard();message(e);notice.textContent+=" — review paused. Refresh to retry.";}
      finally{busy=false;if(pending){pending=false;scheduleRefresh();}}
    }
    async function guardedDraw(){if(busy){pending=true;return;}busy=true;try{await draw();}catch(e){clearCard();message(e);}finally{busy=false;if(pending){pending=false;scheduleRefresh();}}}
    function scheduleRefresh(file,oldPath){if(disposed)return;if(file){dirty.add(file.path);if(oldPath)dirty.add(oldPath);if(!file.path.startsWith(`${dataRoot}/reviews/`) || (oldPath && !oldPath.startsWith(`${dataRoot}/reviews/`)))sourceGeneration++;}clearTimeout(refreshTimer);refreshTimer=setTimeout(guardedDraw,400);}
    home.onclick=()=>{reviewing=false;selectedDeck=null;guardedDraw();};
    select.onchange=()=>{reviewing=Boolean(select.value);selectedDeck=null;guardedDraw();};
    refresh.onclick=()=>{cache.clear();sourceGeneration++;guardedDraw();};
    rebuild.onclick=async()=>{if(busy)return;busy=true;try{await withStoreLock(identity,()=>index.clear());}catch(e){message(e);}finally{busy=false;await guardedDraw();}};
    try {
      manifest=await json(`${dataRoot}/manifest.json`);if(![1,2].includes(manifest.format_version))throw Error("Unsupported store format");
      if(manifest.partition_count!==undefined && (!Number.isSafeInteger(manifest.partition_count)||manifest.partition_count<0))throw Error("Invalid card partition count");
      const partitions=manifest.partition_count===undefined?manifest.partitions:
        Array.from({length:manifest.partition_count},(_,i)=>`imports/${manifest.revision}/cards-${String(i).padStart(5,"0")}.json`);
      for(const partition of partitions)cards.push(...await json(`${dataRoot}/${partition}`));
      index=await ReviewIndex.open(identity,manifest.import_id,manifest.timing);if(disposed){index.close();return;}
      select.createEl("option",{text:"All decks",value:""});
      for(const group of [...new Set(cards.map(c=>c.group).filter(Boolean))].sort())select.createEl("option",{text:group,value:group});
      if(input?.group)select.value=input.group;
      for(const name of ["create","modify","delete","rename"])component.registerEvent(api.vault.on(name,scheduleRefresh));
      component.registerEvent(api.metadataCache.on("changed",scheduleRefresh));
      component.registerInterval(setInterval(()=>{if(!shown)guardedDraw();},60000));await guardedDraw();
    }catch(e){message(e);}
  })();

})();
