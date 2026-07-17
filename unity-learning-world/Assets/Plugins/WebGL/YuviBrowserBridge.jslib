mergeInto(LibraryManager.library, {
  YuviWorldEmit: function (eventTypePointer, detailPointer) {
    var eventType = UTF8ToString(eventTypePointer);
    var detail = UTF8ToString(detailPointer);
    window.dispatchEvent(new CustomEvent('yuvi-unity-world', {
      detail: { type: eventType, payload: detail }
    }));
  }
});
