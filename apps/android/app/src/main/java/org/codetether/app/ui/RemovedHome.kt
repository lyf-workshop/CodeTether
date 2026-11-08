package org.codetether.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.codetether.app.R

@Composable
internal fun RemovedHomePage(computerName: String, openPair: () -> Unit, seeComputers: () -> Unit) {
    val alert = if (ink.dark) Color(0xffff6961) else Color(0xffe5392f)
    val alertText = if (ink.dark) Color(0xffff8a84) else Color(0xffb42318)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 820.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(start = 28.dp, top = 8.dp, end = 28.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            PageTitle("最近的会话")
            Row(
                Modifier.fillMaxWidth().clip(cardShape).background(alert.copy(alpha = if (ink.dark) .16f else .1f))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(painterResource(R.drawable.tablet_removal_alert), null, Modifier.size(20.dp), tint = alert)
                Column {
                    Text("$computerName 已把这台平板移除", color = alertText, fontWeight = FontWeight.Bold,
                        fontSize = 14.sp, lineHeight = 20.sp)
                    Text("要再用它，到那台电脑上打开 设备 › 添加设备，生成新的配对码，然后在这里输入。",
                        color = alertText, fontSize = 14.sp, lineHeight = 20.sp)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RecoveryButton("输入配对码", primary = true, onClick = openPair)
                RecoveryButton("看其他电脑", primary = false, onClick = seeComputers)
            }
        }
    }
}

private val recoveryFill: Color
    @Composable get() = Color(0xff767680).copy(alpha = if (ink.dark) .24f else .12f)

@Composable
private fun RecoveryButton(label: String, primary: Boolean, onClick: () -> Unit) {
    Button(
        onClick, Modifier.heightIn(min = 48.dp), shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (primary) ink.ink else recoveryFill,
            contentColor = if (primary) ink.onInk else ink.text,
        ),
        contentPadding = PaddingValues(horizontal = 18.dp),
    ) { Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
internal fun RemovedPairSheet(state: TabletState, actions: TabletActions, onDismiss: () -> Unit, onConnected: () -> Unit) {
    var code by remember { mutableStateOf("") }
    val connected = state.lastPairedName
    fun close() {
        if (connected != null) onConnected() else {
            if (state.pairingInProgress) actions.cancelPairing()
            actions.dismissError()
            onDismiss()
        }
    }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(16.dp).widthIn(max = 560.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp))
                .background(ink.background),
        ) {
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).background(ink.bar).padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    TextButton(::close, colors = ButtonDefaults.textButtonColors(contentColor = ink.text)) { Text("取消") }
                }
                Text(if (connected == null) "添加电脑" else "已连接", color = ink.text,
                    fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    TextButton(
                        onClick = {
                            if (connected != null) onConnected() else {
                                actions.pair(code)
                                code = ""
                            }
                        },
                        enabled = connected != null || (code.length == 6 && !state.busy),
                        colors = ButtonDefaults.textButtonColors(contentColor = ink.text),
                    ) { Text(if (connected == null) "连接" else "完成", fontWeight = FontWeight.SemiBold) }
                }
            }
            Rule()
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 22.dp,
                    top = 18.dp, end = 22.dp, bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (connected != null) Text(connected, color = ink.text) else {
                    Text("在那台电脑上的 CodeTether 里打开 设备 › 添加设备 › 添加手机或平板，输入屏幕上的 6 位配对码。",
                        color = ink.secondary, fontSize = 15.sp)
                    BasicTextField(
                        value = code,
                        onValueChange = { code = it.filter { digit -> digit in '0'..'9' }.take(6) },
                        modifier = Modifier.padding(top = 10.dp).widthIn(max = 362.dp).fillMaxWidth()
                            .testTag("removed-pair-code").semantics { contentDescription = "配对码" },
                        enabled = !state.busy,
                        textStyle = TextStyle(color = Color.Transparent),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        cursorBrush = SolidColor(Color.Transparent),
                        decorationBox = { innerTextField ->
                            Box(contentAlignment = Alignment.Center) {
                                Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center) { innerTextField() }
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    repeat(6) { index ->
                                        val cell = Modifier.weight(1f).heightIn(min = 64.dp).clip(cardShape).background(recoveryFill)
                                        Box(if (index == code.length) cell.border(2.dp, ink.ink, cardShape) else cell,
                                            contentAlignment = Alignment.Center) {
                                            if (index < code.length) Text("•", color = ink.text, fontFamily = FontFamily.Monospace,
                                                fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
                                        }
                                    }
                                }
                            }
                        },
                    )
                    Text("那台电脑要登录同一个账号。", color = ink.secondary, fontSize = 13.sp)
                    if (state.busy) Text(
                        if (state.pairingClaimed) "正在等电脑完成连接，请保持电脑上的窗口打开。" else "正在连接…",
                        color = ink.secondary,
                    )
                    state.error?.let { Text(it, color = ink.failed, fontSize = 14.sp) }
                }
            }
        }
    }
}
