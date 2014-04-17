#include "node-psi/module.h"

#include <node.h>
#include <uv.h>
#include <v8.h>
#include <Windows.h>
#include <string>

#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/wrapped_process.h"
#include "node-psi/wrapped_registry.h"
#include "psi/psi.h"

using std::wstring;
using v8::Arguments;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Integer;
using v8::Local;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::ThrowException;
using v8::TryCatch;
using v8::Value;

namespace sbat {
namespace psi {

struct LaunchContext {
  uv_work_t req;
  wstring* app_path;
  wstring* arguments;
  bool launch_suspended;
  wstring* current_dir;
  Persistent<Function> callback;

  Process* process;
};

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(*context->app_path, *context->arguments, context->launch_suspended,
      *context->current_dir);
}

void LaunchAfter(uv_work_t* req, int status) {
  HandleScope scope;
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  Local<Value> err = Local<Value>::New(v8::Null());
  Handle<Value> proc = Local<Value>::New(v8::Null());

  if (context->process->has_errors()) {
    err = Exception::Error(String::New(
        reinterpret_cast<const uint16_t*>(context->process->error().message().c_str())));
  } else {
    proc = WrappedProcess::NewInstance(context->process);
  }

  Handle<Value> argv[] = { err, proc };
  TryCatch try_catch;
  context->callback->Call(Context::GetCurrent()->Global(), 2, argv);

  context->callback.Dispose();
  delete context->app_path;
  delete context->arguments;
  delete context->current_dir;
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> LaunchProcess(const Arguments& args) {
  HandleScope scope;

  assert(args.Length() == 5);
  assert(args[4]->IsFunction());

  LaunchContext* context = new LaunchContext;
  context->app_path = ToWstring(args[0]->ToString());
  context->arguments  = ToWstring(args[1]->ToString());
  context->launch_suspended = args[2]->ToBoolean()->BooleanValue();
  context->current_dir = ToWstring(args[3]->ToString());
  context->callback = Persistent<Function>::New(args[4].As<Function>());
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  return scope.Close(v8::Undefined());
}

Handle<Value> DetectResolution(const Arguments& args) {
  HandleScope scope;
  Handle<Object> resolution = Object::New();
  resolution->Set(String::New("width"), Integer::New(GetSystemMetrics(SM_CXSCREEN)));
  resolution->Set(String::New("height"), Integer::New(GetSystemMetrics(SM_CYSCREEN)));

  return scope.Close(resolution);
}

Persistent<Function> callback;

Handle<Value> ShutdownHandler(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() == 1);
  assert(args[0]->IsFunction());

  if (!callback.IsEmpty()) {
    callback.Dispose();
  }

  callback = Persistent<Function>::New(args[0].As<Function>());
  return scope.Close(v8::Undefined());
}

void EmitShutdown() {
  if (callback.IsEmpty()) {
    return;
  }

  callback->Call(Context::GetCurrent()->Global(), 0, nullptr);
}

void Initialize(Handle<Object> exports, Handle<Object> module) {
  WrappedProcess::Init();
  WrappedRegistry::Init();
  PsiService::SetShutdownCallback(EmitShutdown);

  exports->Set(String::NewSymbol("launchProcess"),
    FunctionTemplate::New(LaunchProcess)->GetFunction());
  exports->Set(String::NewSymbol("detectResolution"),
    FunctionTemplate::New(DetectResolution)->GetFunction());
  exports->Set(String::NewSymbol("registerShutdownHandler"),
    FunctionTemplate::New(ShutdownHandler)->GetFunction());
  exports->Set(String::NewSymbol("registry"), WrappedRegistry::NewInstance());
}

NODE_MODULE(psi, Initialize);

}  // namespace psi
}  // namespace sbat