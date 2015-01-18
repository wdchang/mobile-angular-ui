/**
@module mobile-angular-ui.gestures.touch
@description

Device agnostic touch handling.

`touch` module just exposes corresponding `$touch` service, that is an abstraction 
of touch event handling that works with any kind of input devices. It is intended 
for single touch only and provides extended infos about touch like: movement, 
direction, velocity, duration, and more.

$touch service is intended as base to build any single-touch gesture handlers.

## Usage

Require this module doing either

``` js
angular.module('myApp', ['mobile-angular-ui.gestures']);
```

Or standalone

``` js
angular.module('myApp', ['mobile-angular-ui.gestures.touch']);
```

Then you will be able to use the `$touch` service like that:

``` js
var unbindFn = $touch.bind(element, {
   start: function(touchInfo, e);
   move: function(touchInfo, e);
   end: function(touchInfo, e);
   cancel: function(touchInfo, e);
}, options);
```

Where `options` is an object optionally specifing:

- `movementThreshold`: {integer} Minimum movement distance to start handling `touchmove`
- `valid`: {function():bool}` A function returning a boolean value to decide whether handle the touch event or ignore it.
- `sensitiveArea`: A [Bounding Client Rect](https://developer.mozilla.org/en-US/docs/Web/API/Element.getBoundingClientRect) or an element 
   or a function that takes the bound element and returns one of the previous.
   Sensitive area define bounduaries to release touch when movement is outside.
   Default is to:
   
   ``` js
   function($element) {
     $element[0].ownerDocument.documentElement.getBoundingClientRect();
   }
   ```
                   
- `pointerTypes`: {object} Which kind of pointer events you wish to handle, with 
  corresponding event names, by device. eg. 

  ``` js
  {
    'mouse': {
      start: 'mousedown',
      move: 'mousemove',
      end: 'mouseup'
    },
    'touch': {
      start: 'touchstart',
      move: 'touchmove',
      end: 'touchend',
      cancel: 'touchcancel'
    }
  }
  ```

And `touchInfo` is an object containing the following extended informations about the touch event:

- `type`: Normalized event type. Despite of pointer device is always one of `touchstart`, `touchend`, `touchmove`, `touchcancel`.
- `timestamp`: The time object corresponding to the moment this touch event happened.
- `duration`: The difference between this touch event and the corresponding `touchstart`. 
- `startX`: X coord of related `touchstart`.
- `startY`: Y coord of related `touchstart`.
- `prevX`: X coord of previous `touchstart` or `touchmove`.
- `prevY`: Y coord of previous `touchstart` or `touchmove`.
- `x`: X coord of this touch event.
- `y`: Y coord of this touch event.
- `step`: Distance between `<prevX, prevY>` and `<x, y>` points.
- `stepX`: Distance between `prevX` and `x`.
- `stepY`: Distance between `prevY` and `y`.
- `velocity`: Instantaneous velocity of a touch event in pixels per second.
- `averageVelocity`: Average velocity of a touch event from its corresponding `touchstart` in pixels per second.
- `distance`: Distance between `<startX, startY>` and `<x, y>` points.
- `distanceX`: Distance between `startX` and `x`.
- `distanceY`: Distance between `startY` and `y`.
- `total`: Total number of pixels covered by movement, taking account of direction changes and turnarounds.
- `totalX`: Total number of pixels covered by horizontal movement, taking account of direction changes and turnarounds.
- `totalY`: Total number of pixels covered by vertical, taking account of direction changes and turnarounds.
- `direction`: The prevalent, current direction for this touch, one of 'LEFT', 'RIGHT', 'TOP', 'BOTTOM'.
- `angle`: Angle in degree between x axis and the vector `[x, y]`, is `null` when no movement happens.

*/
(function() {
  'use strict';
  var module = angular.module('mobile-angular-ui.gestures.touch', []);

  module.provider('$touch', function() {

    /*=====================================
    =            Configuration            =
    =====================================*/

    var VALID = function() {
      return true;
    };
    
    var MOVEMENT_THRESHOLD = 1;

    var POINTER_EVENTS = {
      'mouse': {
        start: 'mousedown',
        move: 'mousemove',
        end: 'mouseup'
      },
      'touch': {
        start: 'touchstart',
        move: 'touchmove',
        end: 'touchend',
        cancel: 'touchcancel'
      }
    };

    var POINTER_TYPES = ['mouse', 'touch'];

    // function or element or rect
    var SENSITIVE_AREA = function($element) {
      return $element[0].ownerDocument.documentElement.getBoundingClientRect();
    };

    this.setPointerEvents = function(pe) {
      POINTER_EVENTS = pe;
    };

    this.setValid = function(fn) {
      VALID = fn;
    };

    this.setMovementThreshold = function(v) {
      MOVEMENT_THRESHOLD = v;
    };

    this.setSensitiveArea = function(fnOrElementOrRect) {
      SENSITIVE_AREA = fnOrElementOrRect;
    };

    // 
    // Shorthands for minification
    //
    var abs = Math.abs,
        atan2 = Math.atan2,
        sqrt = Math.sqrt;

    /*===============================
    =            Helpers            =
    ===============================*/

    var getCoordinates = function(event) {
      var touches = event.touches && event.touches.length ? event.touches : [event];
      var e = (event.changedTouches && event.changedTouches[0]) ||
          (event.originalEvent && event.originalEvent.changedTouches &&
              event.originalEvent.changedTouches[0]) ||
          touches[0].originalEvent || touches[0];

      return {
        x: e.clientX,
        y: e.clientY
      };
    };

    var getEvents = function(pointerTypes, eventType) {
      var res = [];
      angular.forEach(pointerTypes, function(pointerType) {
        var eventName = POINTER_EVENTS[pointerType][eventType];
        if (eventName) {
          res.push(eventName);
        }
      });
      return res.join(' ');
    };

    var now = function() { 
      return new Date();
    };

    var timediff = function(t1, t2) {
      t2 = t2 || now();
      return abs(t2 - t1);
    };

    var len = function(x, y) {
      return sqrt(x*x + y*y);
    };

    // Compute values for new TouchInfo based on coordinates and previus touches.
    // - c is coords of new touch
    // - t0 is first touch: useful to compute duration and distance (how far pointer 
    //                    got from first touch)
    // - tl is last touch: useful to compute velocity and length (total length of the movement)
    var buildTouchInfo = function(type, c, t0, tl) {
      t0 = t0 || {}; 
      tl = tl || {}; 

      var // timestamps  
          ts = now(), ts0 = t0.timestamp || ts, tsl = tl.timestamp || ts0,
          // coords
          x = c.x, y = c.y, x0 = t0.x || x, y0 = t0.y || y, xl = tl.x || x0, yl = tl.y || y0,
          // total movement
          totalXl = tl.totalX || 0, totalYl = tl.totalY || 0, 
          totalX = totalXl + abs(x - xl), totalY = totalYl + abs(y - yl), 
          total = len(totalX, totalY),
          // duration
          duration = timediff(ts, ts0),
          durationl = timediff(ts, tsl),
          // distance
          dxl = x - xl, dyl = y - yl, dl = len(dxl, dyl),
          dx = x - x0, dy = y - y0, d = len(dx, dy),
          // velocity (px per second)
          v = durationl > 0 ? abs(dl / ( durationl / 1000 )) : 0,
          tv = duration > 0 ? abs(total / (duration / 1000)) : 0,
          // main direction: 'LEFT', 'RIGHT', 'TOP', 'BOTTOM'
          dir = abs(dx) > abs(dy) ?
            (dx < 0 ? 'LEFT' : 'RIGHT'):
            (dy < 0 ? 'TOP' : 'BOTTOM'),
          // angle (angle between distance vector and x axis)
          // angle will be:
          //  0 for x > 0 and y = 0
          //  90 for y < 0 and x = 0
          //  180 for x < 0 and y = 0
          //  -90 for y > 0 and x = 0
          //  
          //              -90°
          //               |
          //               |
          //               |
          //  180° --------|-------- 0°
          //               |
          //               |
          //               |
          //              90°
          //          
          angle = dx !== 0 || dy !== 0  ? atan2(dy, dx) * (180 / Math.PI) : null;
          angle = angle === -180 ? 180 : angle;

      return {
        type: type,
        timestamp: ts,
        duration: duration,
        startX: x0,
        startY: y0,
        prevX: xl,
        prevY: yl,
        x: c.x,
        y: c.y,

        step:  dl, // distance from prev
        stepX: dxl,
        stepY: dyl,

        velocity: v,
        averageVelocity: tv,
        
        distance: d, // distance from start
        distanceX: dx,
        distanceY: dy,

        total: total, // total length of momement,
                      // considering turnaround
        totalX: totalX,
        totalY: totalY,
        direction: dir,
        angle: angle
      };
    };

    /*======================================
    =            Factory Method            =
    ======================================*/

    this.$get = [function() {
      
      return {
        bind: function($element, eventHandlers, options) {

          // ensure element to be an angular element 
          $element = angular.element($element);
          
          options = options || {};
          // uses default pointer types in case of none passed
          var pointerTypes = options.pointerTypes || POINTER_TYPES,
              isValid = options.valid === undefined ? VALID : options.valid,
              movementThreshold = options.movementThreshold === undefined ? MOVEMENT_THRESHOLD : options.valid,
              sensitiveArea = options.sensitiveArea === undefined ? SENSITIVE_AREA : options.sensitiveArea;

          var // first and last touch
              t0, tl,
              // events
              startEvents = getEvents(pointerTypes, 'start'),
              endEvents = getEvents(pointerTypes, 'end'),
              moveEvents = getEvents(pointerTypes, 'move'),
              cancelEvents = getEvents(pointerTypes, 'cancel');

          var startEventHandler = eventHandlers.start,
              endEventHandler = eventHandlers.end,
              moveEventHandler = eventHandlers.move,
              cancelEventHandler = eventHandlers.cancel;

          var $movementTarget = angular.element($element[0].ownerDocument);

          var resetTouch = function() {
            t0 = tl = null;
            $movementTarget.off(moveEvents, onTouchMove);
            $movementTarget.off(endEvents, onTouchEnd);
            if (cancelEvents) { $movementTarget.off(cancelEvents, onTouchCancel); }
          };

          var isActive = function() {
            return !!t0;
          };

          // 
          // Callbacks
          // 

          // on touchstart
          var onTouchStart = function(event) {
            tl = t0 = buildTouchInfo('touchstart', getCoordinates(event));
            $movementTarget.on(moveEvents, onTouchMove);
            $movementTarget.on(endEvents, onTouchEnd);
            if (cancelEvents) { $movementTarget.on(cancelEvents, onTouchCancel); }
            if (startEventHandler) {
              startEventHandler(t0, event); 
            }
          };

          // on touchCancel
          var onTouchCancel = function(event) {
            var t = buildTouchInfo('touchcancel', getCoordinates(event), t0, tl);
            resetTouch();
            if (cancelEventHandler) {
              cancelEventHandler(t, event);
            }
          };

          // on touchMove
          var onTouchMove = function(event) {
            if (!isActive()) { return; }
            
            var coords = getCoordinates(event);

            // 
            // wont fire outside sensitive area
            // 
            var mva = typeof sensitiveArea === 'function' ? sensitiveArea($element) : sensitiveArea;
            mva = mva.length ? mva[0] : mva;
            
            var mvaRect = mva instanceof Element ? mva.getBoundingClientRect() : mva;

            if (coords.x < mvaRect.left || coords.x > mvaRect.right || coords.y < mvaRect.top || coords.y > mvaRect.bottom){ return; }

            var t = buildTouchInfo('touchmove', coords, t0, tl),
                totalX = t.totalX,
                totalY = t.totalY;

            tl = t;
    
            if (totalX < movementThreshold && totalY < movementThreshold) {
              return;
            }

            if (isValid(t, event)) {
              if (event.cancelable === undefined || event.cancelable) {
                event.preventDefault();              
              }
              if (moveEventHandler) {
                moveEventHandler(t, event);
              }
            }
          };

          // on touchEnd
          var onTouchEnd = function(event) {
            if (!isActive()) { return; }
            var t = angular.extend({}, tl, {type: 'touchend'});
            if (isValid(t, event)) {
              if (event.cancelable === undefined || event.cancelable) {
                event.preventDefault();              
              }
              if (endEventHandler) {
                setTimeout(function() { // weird workaround to avoid 
                                        // delays with dom manipulations
                                        // inside the handler
                  endEventHandler(t, event);
                }, 0);
              }
            }
            resetTouch();
          };

          $element.on(startEvents, onTouchStart);

          return function unbind() {
            if ($element) { // <- wont throw if accidentally called twice
              $element.off(startEvents, onTouchStart);
              if (cancelEvents) { $movementTarget.off(cancelEvents, onTouchCancel); }
              $movementTarget.off(moveEvents, onTouchMove);
              $movementTarget.off(endEvents, onTouchEnd);

              // Clear all those variables we carried out from `#bind` method scope
              // to local scope and that we don't have to use anymore
              $element = $movementTarget = startEvents = cancelEvents = moveEvents = endEvents = onTouchStart = onTouchCancel = onTouchMove = onTouchEnd = pointerTypes = isValid = movementThreshold = sensitiveArea = null;
            }
          };
        }
      };
    }];
  });
}());