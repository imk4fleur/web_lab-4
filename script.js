(function () {
  function ApiClient() {
    this.BASE = {
      GEOCODE_SEARCH: 'https://geocoding-api.open-meteo.com/v1/search',
      GEOCODE_REVERSE: 'https://geocoding-api.open-meteo.com/v1/reverse',
      FORECAST: 'https://api.open-meteo.com/v1/forecast'
    };
  }

  ApiClient.prototype.geocodeSuggest = async function (q, count) {
    if (typeof count === 'undefined') {
      count = 8;
    }
    var url = this.BASE.GEOCODE_SEARCH + '?name=' + encodeURIComponent(q) + '&count=' + count + '&language=ru&format=json';
    var r = await fetch(url);
    if (!r.ok) {
      throw new Error('Ошибка подсказок геокода');
    }
    return r.json();
  };

  ApiClient.prototype.geocodeByCoords = async function (lat, lon) {
    var url = this.BASE.GEOCODE_REVERSE + '?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&count=1&language=ru';
    var r = await fetch(url);
    if (!r.ok) {
      return null;
    }
    return r.json();
  };

  ApiClient.prototype.forecast = async function (lat, lon, days) {
    if (typeof days === 'undefined') {
      days = 3;
    }
    var url = this.BASE.FORECAST + '?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=' + days;
    var r = await fetch(url);
    if (!r.ok) {
      throw new Error('Ошибка получения прогноза');
    }
    return r.json();
  };

  function StorageHelper() {}

  StorageHelper.safeParse = function (raw, fallback) {
    try {
      if (raw === null || typeof raw === 'undefined') {
        return fallback;
      }
      var p = JSON.parse(raw);
      if (p === null) {
        return fallback;
      } else {
        return p;
      }
    } catch (e) {
      return fallback;
    }
  };

  StorageHelper.get = function (key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return StorageHelper.safeParse(raw, fallback);
    } catch (e) {
      return fallback;
    }
  };

  StorageHelper.set = function (key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('localStorage:set error', e);
    }
  };

  function uid(n) {
    if (typeof n === 'undefined') {
      n = 8;
    }
    return Math.random().toString(36).slice(2, 2 + n);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
      return map[m];
    });
  }

  function debounce(fn, ms) {
    if (typeof ms === 'undefined') {
      ms = 250;
    }
    var t = null;
    return function () {
      var args = Array.prototype.slice.call(arguments);
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(null, args);
      }, ms);
    };
  }

  var monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  function humanDate(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d)) {
        return String(iso);
      }
      return d.getDate() + ' ' + monthNames[d.getMonth()];
    } catch (e) {
      return String(iso);
    }
  }

  var WEATHER_MAP = {
    0: "Ясно", 1: "Частично облачно", 2: "Облачно", 3: "Пасмурно",
    45: "Туман", 48: "Туман с инеем",
    51: "Мелкий дождь", 53: "Умеренный дождь", 55: "Сильный дождь",
    61: "Дождь", 63: "Сильный дождь", 65: "Сильный дождь",
    71: "Снег", 73: "Сильный снег", 75: "Очень сильный снег",
    80: "Ливень", 81: "Сильный ливень", 82: "Очень сильный ливень",
    95: "Гроза", 96: "Гроза с небольшим градом", 99: "Гроза с градом"
  };

  function WeatherManager() {
    this.api = new ApiClient();
    this.storeKey = 'weather_app:places_v2';
    this.places = StorageHelper.get(this.storeKey, []) || [];
    this.suggestCache = new Map();
    this.pick = null;
    this.nodes = {
      grid: document.getElementById('grid'),
      search: document.getElementById('city-search'),
      suggestions: document.getElementById('city-suggestions'),
      addBtn: document.getElementById('btn-add'),
      geoBtn: document.getElementById('btn-geo'),
      refreshBtn: document.getElementById('btn-refresh'),
      err: document.getElementById('input-error'),
      locationLabel: document.getElementById('locationLabel')
    };

    this._bind();
    if (this.places.length === 0 && 'geolocation' in navigator) {
      this._trySetGeo(false).finally((function (self) {
        return function () {
          self.renderAll();
        };
      })(this));
    } else {
      this.renderAll();
    }
  }

  WeatherManager.prototype._bind = function () {
    var self = this;

    if (this.nodes.search) {
      this.nodes.search.addEventListener('input', debounce(function (e) { self._onSearch(e); }, 260));
      this.nodes.search.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          self.addFromInput();
        }
        if (ev.key === 'Escape') {
          self._hideSuggestions();
        }
      });
    }

    if (this.nodes.suggestions) {
      this.nodes.suggestions.addEventListener('click', function (e) {
        var li = e.target.closest('li');
        if (!li) {
          return;
        }
        var nameVal;
        if (li.dataset.name) {
          nameVal = li.dataset.name;
        } else {
          nameVal = li.textContent.trim();
        }

        var displayVal;
        if (li.dataset.display) {
          displayVal = li.dataset.display;
        } else {
          displayVal = li.textContent.trim();
        }

        var lat = parseFloat(li.dataset.lat);
        var lon = parseFloat(li.dataset.lon);

        self.pick = {
          name: nameVal,
          display: displayVal,
          lat: lat,
          lon: lon
        };

        if (self.nodes.search) {
          self.nodes.search.value = self.pick.display;
        }
        self._hideSuggestions();
      });
    }

    document.addEventListener('click', function (e) {
      try {
        if (self.nodes.search && self.nodes.suggestions) {
          if (!self.nodes.search.contains(e.target) && !self.nodes.suggestions.contains(e.target)) {
            self._hideSuggestions();
          }
        }
      } catch (ignore) { }
    });

    if (this.nodes.addBtn) {
      this.nodes.addBtn.addEventListener('click', function () { self.addFromInput(); });
    }
    if (this.nodes.geoBtn) {
      this.nodes.geoBtn.addEventListener('click', function () { self._trySetGeo(true); });
    }
    if (this.nodes.refreshBtn) {
      this.nodes.refreshBtn.addEventListener('click', function () { self.refreshAll(); });
    }
  };

  WeatherManager.prototype._onSearch = async function () {
    var q = '';
    if (this.nodes.search && this.nodes.search.value) {
      q = this.nodes.search.value.trim();
    } else {
      q = ''.trim();
    }

    this.pick = null;
    if (this.nodes.err) {
      this.nodes.err.textContent = '';
    }

    if (!q) {
      this._hideSuggestions();
      return;
    }

    if (this.suggestCache.has(q)) {
      var cached = this.suggestCache.get(q);
      this._renderSuggestions(cached);
      return;
    }

    try {
      var res = await this.api.geocodeSuggest(q, 8);
      var list = [];
      if (res && res.results) {
        list = res.results;
      } else {
        list = [];
      }
      this.suggestCache.set(q, list);
      this._renderSuggestions(list);
    } catch (err) {
      console.warn('suggest error', err);
      this._hideSuggestions();
    }
  };

  WeatherManager.prototype._renderSuggestions = function (list) {
    if (!this.nodes.suggestions) {
      return;
    }
    if (!list || list.length === 0) {
      this._hideSuggestions();
      return;
    }

    var html = list.map(function (r) {
      var disp = r.name;
      if (r.admin1) {
        disp += ', ' + r.admin1;
      }
      if (r.country) {
        disp += ', ' + r.country;
      }
      var escaped = escapeHtml(disp);
      var escapedName = escapeHtml(r.name);
      return '<li data-lat="' + r.latitude + '" data-lon="' + r.longitude + '" data-display="' + escaped + '" data-name="' + escapedName + '">' + escaped + '</li>';
    }).join('');

    this.nodes.suggestions.innerHTML = html;
    this.nodes.suggestions.classList.add('show');
  };

  WeatherManager.prototype._hideSuggestions = function () {
    if (!this.nodes.suggestions) {
      return;
    }
    this.nodes.suggestions.classList.remove('show');
    this.nodes.suggestions.innerHTML = '';
  };

  WeatherManager.prototype.addFromInput = async function () {
    var raw = '';
    if (this.nodes.search && this.nodes.search.value) {
      raw = this.nodes.search.value.trim();
    } else {
      raw = '';
    }

    if (this.nodes.err) {
      this.nodes.err.textContent = '';
    }

    if (!raw) {
      if (this.nodes.err) {
        this.nodes.err.textContent = 'Введите название города';
      }
      return;
    }

    try {
      if (this.pick && this.pick.display === raw) {
        var p = this.pick;
        if (this._isDupCoords(p.lat, p.lon)) {
          if (this.nodes.err) {
            this.nodes.err.textContent = 'Этот город уже добавлен.';
          }
          return;
        }
        this.places.push({ id: uid(), name: p.name, displayName: p.display, lat: p.lat, lon: p.lon, isGeo: false });
        StorageHelper.set(this.storeKey, this.places);
        if (this.nodes.search) {
          this.nodes.search.value = '';
        }
        this.pick = null;
        this.renderAll();
        return;
      }

      if (this.nodes.err) {
        this.nodes.err.textContent = 'Проверка...';
      }

      var resp = await this.api.geocodeSuggest(raw, 5);

      if (!resp || !resp.results || resp.results.length === 0) {
        if (this.nodes.err) {
          this.nodes.err.textContent = 'Город не найден.';
        }
        return;
      }

      var best = resp.results[0];

      if (this._isDupCoords(best.latitude, best.longitude)) {
        if (this.nodes.err) {
          this.nodes.err.textContent = 'Этот город уже добавлен.';
        }
        return;
      }

      var disp = best.name;
      if (best.admin1) {
        disp += ', ' + best.admin1;
      }
      if (best.country) {
        disp += ', ' + best.country;
      }

      this.places.push({ id: uid(), name: best.name, displayName: disp, lat: best.latitude, lon: best.longitude, isGeo: false });
      StorageHelper.set(this.storeKey, this.places);
      if (this.nodes.search) {
        this.nodes.search.value = '';
      }
      if (this.nodes.err) {
        this.nodes.err.textContent = '';
      }
      this.renderAll();
    } catch (err) {
      console.error('addFromInput', err);
      if (this.nodes.err) {
        this.nodes.err.textContent = 'Ошибка сети';
      }
    }
  };

  WeatherManager.prototype._isDupCoords = function (lat, lon) {
    if (!Array.isArray(this.places)) {
      return false;
    }
    for (var i = 0; i < this.places.length; i++) {
      var p = this.places[i];
      var latA = p.lat || 0;
      var lonA = p.lon || 0;
      if (Math.abs(latA - (lat || 0)) < 1e-6 && Math.abs(lonA - (lon || 0)) < 1e-6) {
        return true;
      }
    }
    return false;
  };

  WeatherManager.prototype._trySetGeo = async function (showErrors) {
    var self = this;
    if (typeof showErrors === 'undefined') {
      showErrors = true;
    }

    if (!('geolocation' in navigator)) {
      if (showErrors && this.nodes.err) {
        this.nodes.err.textContent = 'Геолокация не поддерживается';
      }
      return;
    }

    var getPos = function (opts) {
      return new Promise(function (res, rej) {
        navigator.geolocation.getCurrentPosition(res, rej, opts);
      });
    };

    try {
      var pos = await getPos({ timeout: 10000 });
      var lat = pos.coords.latitude;
      var lon = pos.coords.longitude;
      var display = 'Текущее местоположение';

      try {
        var rev = await this.api.geocodeByCoords(lat, lon);
        if (rev && rev.results && rev.results[0]) {
          var r = rev.results[0];
          display = r.name;
          if (r.admin1) {
            display += ', ' + r.admin1;
          }
          if (r.country) {
            display += ', ' + r.country;
          }
        }
      } catch (e) {
      }

      var existingGeo = null;
      for (var j = 0; j < this.places.length; j++) {
        if (this.places[j].isGeo) {
          existingGeo = this.places[j];
          break;
        }
      }

      if (existingGeo) {
        existingGeo.lat = lat;
        existingGeo.lon = lon;
        existingGeo.displayName = display;
      } else {
        this.places.unshift({ id: uid(), name: 'geo', displayName: display, lat: lat, lon: lon, isGeo: true });
      }

      StorageHelper.set(this.storeKey, this.places);
      this.renderAll();
      if (this.nodes.err) {
        this.nodes.err.textContent = '';
      }
    } catch (err) {
      if (!showErrors) {
        return;
      }
      console.warn('geo error', err);
      if (err && err.code === 1 && this.nodes.err) {
        this.nodes.err.textContent = 'Доступ к геопозиции запрещён';
      } else if (this.nodes.err) {
        this.nodes.err.textContent = 'Не удалось получить геопозицию';
      }
    }
  };

  WeatherManager.prototype._makeCard = function (place) {
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = place.id;

    var typeText;
    if (place.isGeo) {
      typeText = 'Текущее местоположение';
    } else {
      typeText = 'Город';
    }

    var safeName = escapeHtml(place.displayName || place.name);

    var inner = '';
    inner += '<div class="card-head">';
    inner += '<div>';
    inner += '<div class="city-name">' + safeName + '</div>';
    inner += '<div class="city-type">' + typeText + '</div>';
    inner += '</div>';
    inner += '<div class="card-actions">';
    inner += '<button class="btn-mini remove">Удалить</button>';
    inner += '</div>';
    inner += '</div>';
    inner += '<div class="card-body"><div class="loading">Загрузка...</div></div>';

    card.innerHTML = inner;

    var btn = card.querySelector('.remove');
    btn.addEventListener('click', (function (self, placeId) {
      return function () {
        var wasGeo = null;
        for (var k = 0; k < self.places.length; k++) {
          if (self.places[k].id === placeId && self.places[k].isGeo) {
            wasGeo = self.places[k];
            break;
          }
        }
        var newPlaces = [];
        for (var m = 0; m < self.places.length; m++) {
          if (self.places[m].id !== placeId) {
            newPlaces.push(self.places[m]);
          }
        }
        self.places = newPlaces;
        StorageHelper.set(self.storeKey, self.places);
        self.renderAll();
        if (wasGeo) {
          self._updateLocationLabel();
        }
      };
    })(this, place.id));

    return card;
  };

  WeatherManager.prototype._fillForecastIntoCard = async function (place, card) {
    var body = card.querySelector('.card-body');
    if (!body) {
      return;
    }
    body.innerHTML = '<div class="loading">Загрузка...</div>';

    try {
      var lat = place.lat;
      var lon = place.lon;

      if ((!lat || !lon) && !place.isGeo) {
        var resp = await this.api.geocodeSuggest(place.name, 1);
        if (!resp || !resp.results || resp.results.length === 0) {
          body.innerHTML = '<div class="forecast-error">Город не найден.</div>';
          return;
        }
        var g = resp.results[0];
        lat = g.latitude;
        lon = g.longitude;
        place.lat = lat;
        place.lon = lon;
        StorageHelper.set(this.storeKey, this.places);
      }

      var fx = await this.api.forecast(lat, lon, 3);
      var times = [];
      if (fx.daily && fx.daily.time) {
        times = fx.daily.time;
      } else {
        times = [];
      }
      var tmin = [];
      if (fx.daily && fx.daily.temperature_2m_min) {
        tmin = fx.daily.temperature_2m_min;
      } else {
        tmin = [];
      }
      var tmax = [];
      if (fx.daily && fx.daily.temperature_2m_max) {
        tmax = fx.daily.temperature_2m_max;
      } else {
        tmax = [];
      }
      var codes = [];
      if (fx.daily && fx.daily.weathercode) {
        codes = fx.daily.weathercode;
      } else {
        codes = [];
      }

      var html = '';
      for (var i = 0; i < 3; i++) {
        var label;
        if (i === 0) {
          label = 'Сегодня';
        } else if (i === 1) {
          label = 'Завтра';
        } else {
          label = 'Послезавтра';
        }

        var tv = '';
        if (typeof times[i] !== 'undefined') {
          tv = times[i];
        } else {
          tv = '';
        }

        var minV;
        if (typeof tmin[i] !== 'undefined') {
          minV = Math.round(tmin[i]);
        } else {
          minV = '—';
        }

        var maxV;
        if (typeof tmax[i] !== 'undefined') {
          maxV = Math.round(tmax[i]);
        } else {
          maxV = '—';
        }

        var txt;
        if (typeof codes[i] !== 'undefined' && WEATHER_MAP[codes[i]]) {
          txt = WEATHER_MAP[codes[i]];
        } else {
          txt = '—';
        }

        var dayHtml = '';
        dayHtml += '<div class="day-row">';
        dayHtml += '<div class="left">';
        if (tv) {
          dayHtml += '<div class="day-label">' + label + ' (' + humanDate(tv) + ')</div>';
        } else {
          dayHtml += '<div class="day-label">' + label + '</div>';
        }
        dayHtml += '<div class="day-desc">' + escapeHtml(txt) + '</div>';
        dayHtml += '</div>';
        dayHtml += '<div class="temps">' + minV + '°C — ' + maxV + '°C</div>';
        dayHtml += '</div>';

        html += dayHtml;
      }

      body.innerHTML = html;
    } catch (err) {
      console.error('fill forecast', err);
      var msg = '';
      if (err && err.message) {
        msg = err.message;
      } else {
        msg = 'ошибка';
      }
      body.innerHTML = '<div class="forecast-error">Ошибка загрузки: ' + escapeHtml(msg) + '</div>';
    }
  };

  WeatherManager.prototype.renderAll = function () {
    if (!this.nodes.grid) {
      return;
    }
    this.nodes.grid.innerHTML = '';

    if (!Array.isArray(this.places) || this.places.length === 0) {
      this.nodes.grid.innerHTML = '<div class="loading">Нет сохранённых городов. Разрешите геопозицию или добавьте город вручную.</div>';
      this._updateLocationLabel();
      return;
    }

    for (var idx = 0; idx < this.places.length; idx++) {
      var place = this.places[idx];
      var card = this._makeCard(place);
      this.nodes.grid.appendChild(card);
      this._fillForecastIntoCard(place, card);
    }
    this._updateLocationLabel();
  };

  WeatherManager.prototype._updateLocationLabel = function () {
    var geo = null;
    for (var i = 0; i < this.places.length; i++) {
      if (this.places[i].isGeo) {
        geo = this.places[i];
        break;
      }
    }

    if (!this.nodes.locationLabel) {
      return;
    }

    if (geo) {
      var name;
      if (geo.displayName) {
        name = geo.displayName;
      } else {
        name = 'Текущее местоположение';
      }
      this.nodes.locationLabel.textContent = 'Местоположение: ' + name;
    } else {
      this.nodes.locationLabel.textContent = '';
    }
  };

  WeatherManager.prototype.refreshAll = async function () {
    var nodeList = Array.from(document.querySelectorAll('.card'));
    for (var i = 0; i < nodeList.length; i++) {
      var card = nodeList[i];
      var id = card.dataset.id;
      var place = null;
      for (var j = 0; j < this.places.length; j++) {
        if (this.places[j].id === id) {
          place = this.places[j];
          break;
        }
      }
      if (place) {
        await this._fillForecastIntoCard(place, card);
      }
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.__WeatherApp = new WeatherManager();
  });

})();
