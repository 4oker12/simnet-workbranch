import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptUrl = new URL(
  "../extension/src/userside-task-staff-ui.js",
  import.meta.url
);

test("Integrated Userside task staff module keeps consistent source metadata", async () => {
  const source = await fs.readFile(scriptUrl, "utf8");
  const header = source.slice(0, source.indexOf("// ==/UserScript==") + 21);
  const metadataVersion = header.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
  const runtimeVersion = source.match(
    /const VERSION = ['"]([^'"]+)['"];/
  )?.[1];

  assert.equal(metadataVersion, "5.9.10-create-form-fix");
  assert.equal(runtimeVersion, metadataVersion);
  assert.match(header, /^\/\/ @match\s+https:\/\/userside\.simnet\.kiev\.ua\/\*$/m);
  assert.match(header, /^\/\/ @grant\s+none$/m);
  assert.ok(!header.includes("@require"));
  assert.ok(!header.includes("@connect"));
});

async function loadTestApi() {
  const source = await fs.readFile(scriptUrl, "utf8");
  const startMarker = "    if (document.readyState === 'loading') {";
  assert.ok(source.includes(startMarker));

  const instrumented = source.replace(
    startMarker,
    [
      "    globalThis.__US_STAFF_TEST__ = {",
      "        fixNativeValidation,",
      "        isTaskSaveControl",
      "    };",
      "",
      startMarker
    ].join("\n")
  );
  const context = {
    console,
    document: {
      readyState: "loading",
      addEventListener() {}
    },
    location: {
      href: "https://userside.simnet.kiev.ua/task/dialog_add?typer=1",
      hostname: "userside.simnet.kiev.ua",
      origin: "https://userside.simnet.kiev.ua",
      pathname: "/task/dialog_add",
      search: "?typer=1"
    },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(instrumented, context, {
    filename: "userside-task-staff-ui.js"
  });

  return {
    api: context.__US_STAFF_TEST__,
    source
  };
}

function fakeControl({
  tagName = "INPUT",
  type = "",
  id = "",
  name = "",
  text = "",
  href = "",
  onclick = "",
  inForm = true
} = {}) {
  const attributes = { href, id, name, onclick, title: "" };
  return {
    tagName,
    type,
    id,
    name,
    textContent: text,
    value: text,
    getAttribute(attribute) {
      return attributes[attribute] || "";
    },
    hasAttribute() {
      return false;
    },
    closest(selector) {
      return selector === "form" && inForm ? {} : null;
    }
  };
}

test("Address and auxiliary add controls are not treated as task submission", async () => {
  const { api } = await loadTestApi();

  assert.equal(api.isTaskSaveControl(fakeControl({
    type: "text",
    id: "inputAddressFastFindtask_addressId"
  })), false);
  assert.equal(api.isTaskSaveControl(fakeControl({
    tagName: "A",
    id: "linkAddNodeId",
    text: "Добавить"
  })), false);
  assert.equal(api.isTaskSaveControl(fakeControl({
    tagName: "A",
    id: "linkAddDeviceId",
    text: "Добавить"
  })), false);

  assert.equal(api.isTaskSaveControl(fakeControl({
    type: "submit",
    id: "submit_but_idform_task",
    text: "Сохранить"
  })), true);
  assert.equal(api.isTaskSaveControl(fakeControl({
    tagName: "BUTTON",
    type: "submit",
    text: "Добавить"
  })), true);
  assert.equal(api.isTaskSaveControl(fakeControl({
    tagName: "A",
    id: "linkSaveTask",
    text: "Сохранить"
  })), true);
});

test("Native validation cleanup is limited to staff UI controls", async () => {
  const { api } = await loadTestApi();

  function validationControl({ managed = false, id = "", name = "" } = {}) {
    const attributes = new Set(["required", "aria-required"]);
    return {
      id,
      name,
      removeAttribute(attribute) {
        attributes.delete(attribute);
      },
      setCustomValidity(value) {
        this.customValidity = value;
      },
      closest() {
        return managed ? {} : null;
      },
      attributes
    };
  }

  const unrelatedHiddenAddress = validationControl({
    id: "buildingIdtask_address"
  });
  unrelatedHiddenAddress.type = "hidden";
  const managedStaff = validationControl({
    managed: true,
    name: "division_task_staffids[]"
  });
  managedStaff.type = "hidden";

  api.fixNativeValidation({
    querySelectorAll() {
      return [unrelatedHiddenAddress, managedStaff];
    }
  });

  assert.equal(unrelatedHiddenAddress.attributes.has("required"), true);
  assert.equal(managedStaff.attributes.has("required"), false);
  assert.equal(managedStaff.customValidity, "");
});

test("Userside task staff source contains no embedded control bytes", async () => {
  const { source } = await loadTestApi();
  const controlCharacters = [...source].filter((character) => {
    const code = character.codePointAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  });

  assert.deepEqual(controlCharacters, []);
  assert.match(source, /\/\(\?:\\bжк\\b\|житл\|льгот\)\/i/);
});
